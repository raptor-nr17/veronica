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
  function leesHealth(d, t, bronNaam) {
    const x = d && typeof d === 'object' ? d : {};
    const m = x.metrics && typeof x.metrics === 'object' ? x.metrics : {};
    const bron = bronNaam || 'OlliteRT /health';
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
  // 456: wat de telefoon over zichzelf zegt (RAM, Android, 64-bits, vrije ruimte): alleen getallen en een ja/nee, binnen redelijke grenzen.
  function leesCapaciteit(c) {
    if (!c || typeof c !== 'object') return null;
    const g = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
    const uit = { ramGb: g(c.ramGb, 512), sdk: g(c.sdk, 100), arm64: typeof c.arm64 === 'boolean' ? c.arm64 : null, vrijGb: g(c.vrijGb, 100000) };
    return Object.values(uit).every((v) => v === null) ? null : uit;
  }
  // 456b: dubbele Gemma-apps of modelkopieen op een telefoon. Alleen bekende namen, getallen en ja/nee, en een zin die als TEKST wordt getoond.
  const GEMMA_APPS = ['OlliteRT', 'OlliteRT (dev)', 'OlliteRT (beta)', 'Google AI Edge Gallery'];
  const OLLITE_TOESTANDEN = ['klaar', 'geen-model', 'staat-niet-aan', 'niet-geinstalleerd', 'onbekend'];
  function leesGemma(g) {
    if (!g || typeof g !== 'object') return null;
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
    const o = g.olliteRt && typeof g.olliteRt === 'object' ? g.olliteRt : null;
    return {
      melding: typeof g.melding === 'string' && g.melding.trim() ? g.melding.replace(/[\u0000-\u001f]/g, ' ').slice(0, 800) : null,
      apps: Array.isArray(g.apps) ? g.apps.filter((a) => GEMMA_APPS.includes(a)) : [],
      kopieen: n(g.kopieen), opruimbaarMb: n(g.opruimbaarMb), kanOpruimen: g.kanOpruimen === true,
      ollite: g.ollite && typeof g.ollite === 'object' && OLLITE_TOESTANDEN.includes(g.ollite.toestand) ? { toestand: g.ollite.toestand, zin: String(g.ollite.zin || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 300), kanStarten: g.ollite.kanStarten === true } : null,
      olliteRt: o ? { health: typeof o.health === 'boolean' ? o.health : null, metrics: typeof o.metrics === 'boolean' ? o.metrics : null, modellen: Number.isInteger(o.modellen) ? o.modellen : null } : null,
    };
  }
  // 460b: DE EIGEN MOTOR van JARVIS (LiteRT-LM). Alleen een vaste fase, getallen en een zin die als TEKST getoond wordt.
  const MOTOR_FASEN = ['uit', 'te-oud', 'wacht', 'zoeken', 'downloaden', 'laden', 'klaar', 'gepauzeerd', 'fout'];
  function leesMotor(m) {
    if (!m || typeof m !== 'object' || m.motor !== 'jarvis-zelf' || !MOTOR_FASEN.includes(m.fase)) return null;
    const n = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v * 10) / 10) : 0);
    return {
      aan: m.aan === true, fase: m.fase, klaar: m.klaar === true && m.fase === 'klaar',
      zin: typeof m.zin === 'string' ? m.zin.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200) : '',
      procent: Math.round(n(m.procent, 100)), poort: Number.isInteger(m.poort) && m.poort >= 1024 && m.poort <= 65535 ? m.poort : 8081,
      backend: m.backend === 'GPU' || m.backend === 'CPU' ? m.backend : '', tokensPerSeconde: n(m.tokensPerSeconde, 10000),
      klussen: Math.round(n(m.klussen, 1000000)), geheugenGb: Math.round(n(m.geheugenMb, 1000000) / 100) / 10, batterijVrij: m.batterijVrij === true,
    };
  }
  function motorZin(m) {
    if (!m) return null;
    const kop = 'Motor: JARVIS zelf';
    if (!m.aan) return `${kop} · uit. Aanzetten kan met de knop hieronder (de telefoon haalt het model alleen op wifi en aan de lader binnen).`;
    if (m.fase === 'te-oud') return `${kop} · ${m.zin || 'deze telefoon is te oud voor de eigen motor'}`;
    if (m.fase === 'downloaden') return `${kop} · model downloaden ${m.procent}%`;
    if (m.fase === 'laden') return `${kop} · model laden`;
    if (m.klaar) return `${kop} · klaar${m.backend ? ` (${m.backend})` : ''}${m.tokensPerSeconde > 0 ? ` · ±${String(m.tokensPerSeconde).replace('.', ',')} tokens/s (geschat)` : ''}${m.klussen ? ` · ${m.klussen} ${m.klussen === 1 ? 'vraag' : 'vragen'}` : ''}`;
    return `${kop} · ${m.zin || m.fase}`;
  }
  // Het adres van de eigen motor op die telefoon: host van JARVIS + de poort die de telefoon zelf meldt (alleen als hij klaar is).
  function motorAdres(t, status) {
    const m = status && status.motor && status.motor.waarde;
    const h = /^http:\/\/([^:/]+)/.exec(String(t && t.jarvis || ''));
    if (!m || !m.klaar || !h) return null;
    return `http://${h[1]}:${m.poort}`;
  }
  // 457: de AI-kern meldt alleen getallen en een ja/nee. Veronica zegt het in een zin.
  function leesAikern(a) {
    if (!a || typeof a !== 'object') return null;
    const n = (v) => (Number.isInteger(v) && v >= 0 && v < 1000 ? v : 0);
    return { noodstop: a.noodstop === true, klanten: n(a.klanten), voorstellenOpen: n(a.voorstellenOpen), geweigerd: n(a.geweigerd) };
  }
  function kernZin(a) {
    if (!a) return null;
    if (a.noodstop) return 'AI-kern: de noodstop staat aan. Er start niets.';
    const w = a.voorstellenOpen === 0 ? 'er wacht niets op jou' : a.voorstellenOpen === 1 ? 'er wacht 1 voorstel op jouw goedkeuring' : `er wachten ${a.voorstellenOpen} voorstellen op jouw goedkeuring`;
    return `AI-kern: ${a.klanten} ${a.klanten === 1 ? 'klant' : 'klanten'}, ${w}.`;
  }
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
      inGebruik: meting(typeof x.inGebruik === 'boolean' ? x.inGebruik : null, bron, t),
      kernMeerekenen: meting(typeof x.kernMeerekenen === 'boolean' ? x.kernMeerekenen : null, bron, t),
      capaciteit: meting(leesCapaciteit(x.capaciteit), bron, t),
      gemma: meting(leesGemma(x.gemma), bron, t),
      rol: meting(x.rol === 'baas' || x.rol === 'werker' ? x.rol : null, bron, t),
      aikern: meting(leesAikern(x.aikern), bron, t),
      motor: meting(leesMotor(x.motor), bron, t),
      adressen: meting(Array.isArray(x.adressen) ? x.adressen.map((a) => normaalAdres(a, OLLITERT_POORT)).filter(Boolean).slice(0, 4) : null, bron, t),
      priveSleutel: meting(x.prive && typeof x.prive === 'object' && typeof x.prive.sleutel === 'boolean' ? x.prive.sleutel : null, bron, t),   // 466: ALLEEN ja/nee, nooit inhoud
      versie: meting(typeof x.versie === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(x.versie) ? x.versie : null, bron, t),
    };
  }
  // 1.9.21 (452): WELKE JARVIS DRAAIT ER? Elke telefoon meldt zijn versie in /jarvis/status. Veronica zet hem bij de
  // telefoon en zegt in EEN zin of hij achterloopt, en dat het vanzelf gaat. De nieuwste versie is de hoogste die ze
  // ziet, of JARVIS_NIEUWSTE (de versie waarmee deze Veronica is gemaakt) -- nooit een versie die nergens genoemd wordt.
  const JARVIS_NIEUWSTE = '1.9.31';
  function vergelijkVersie(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
  }
  function nieuwsteVersie(versies) {
    return (versies || []).concat([JARVIS_NIEUWSTE]).filter((v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)).reduce((m, v) => (vergelijkVersie(v, m) > 0 ? v : m));
  }
  // Terug: { tekst, achter } of null (versie onbekend: niets zeggen, niets verzinnen).
  function versieZin(versie, nieuwste, rol) {
    if (typeof versie !== 'string' || !/^\d+\.\d+\.\d+$/.test(versie)) return null;
    if (vergelijkVersie(versie, nieuwste) >= 0) return { tekst: `JARVIS ${versie}`, achter: false };
    const wacht = rol === 'baas' ? ' De baas wacht daarbij tot de werkers klaar zijn.' : '';
    return { tekst: `JARVIS ${versie}: loopt achter op ${nieuwste}. Hij werkt zichzelf vanzelf bij zodra hij aan de lader ligt en niets doet (hij kijkt elke zes uur; sneller kan met Instellingen, Kijk of er een nieuwe versie is).${wacht}`, achter: true };
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
        alternatieven: (Array.isArray(ruw.alternatieven) ? ruw.alternatieven : []).map((a) => normaalAdres(a, OLLITERT_POORT)).filter((a) => a && a !== adres).slice(0, 4),
        // De plek (1.9.0): mobiel (in je broekzak) of rek (koeler en stekker). Onbekend = null.
        plek: ruw.plek === 'mobiel' || ruw.plek === 'rek' ? ruw.plek : null,
        sleutel: typeof ruw.sleutel === 'string' ? ruw.sleutel.slice(0, 200) : '',
      });
    }
    // De stekkers (Tasmota): Veronica LEEST de watts; schakelen doet JARVIS (ook de handknop van Veronica gaat via JARVIS).
    const stekkers = [];
    for (const k of Array.isArray(x.stekkers) ? x.stekkers : []) {
      const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(String((k && k.ip) || '').trim());
      if (!m || !isEigenNet(m[1]) || stekkers.some((s) => s.ip === m[0])) continue;
      stekkers.push({ naam: String(k.naam || 'Stekker').slice(0, 40), ip: m[0], rol: k.rol === 'laden' || k.rol === 'meter' ? k.rol : 'ventilator' });
    }
    // 452b: stekkers die JARVIS op het wifi VOND maar nog niet vertrouwt. Veronica toont er twee knoppen bij.
    const stekkersGevonden = [];
    for (const k of Array.isArray(x.stekkersGevonden) ? x.stekkersGevonden : []) {
      const m = /^(\d{1,3}(?:\.\d{1,3}){3})$/.exec(String((k && k.ip) || '').trim());
      const mac = String((k && k.mac) || '').trim().toUpperCase();
      if (!m || !isEigenNet(m[1]) || !/^[0-9A-F:]{12,17}$/.test(mac) || stekkersGevonden.some((g) => g.mac === mac) || stekkersGevonden.length >= 6) continue;
      stekkersGevonden.push({ naam: String(k.naam || 'Stekker').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'Stekker', ip: m[1], mac });
    }
    // 452b: wie antwoordt, de baas of een werker? Alleen de baas is gezaghebbend voor de stekkers.
    // 455: van een privé-klus weet Veronica ALLEEN dat er een bezig is. Geen titel, geen soort, geen tekst.
    // 463b: wat de laatste zoekronde van de baas deed (alleen tellers en wifi-nummers).
    const sc = x.stekkerScan && typeof x.stekkerScan === 'object' ? x.stekkerScan : null;
    const tel = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100000 ? Math.round(v) : null);
    const stekkerScan = sc && tel(sc.leeftijdMs) !== null && tel(sc.gescand) !== null
      ? { leeftijdMs: tel(sc.leeftijdMs), netten: (Array.isArray(sc.netten) ? sc.netten : []).map((n) => String(n)).filter((n) => /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(n)).slice(0, 4), gescand: tel(sc.gescand), antwoord: tel(sc.antwoord) || 0, tasmota: tel(sc.tasmota) || 0, door: sc.door === 'op verzoek' ? 'op verzoek' : 'vanzelf' }
      : null;
    const priveBezig = x.prive && typeof x.prive === 'object' && Number(x.prive.bezig) > 0 ? 1 : 0;
    return { telefoons: uit, stekkers, stekkersGevonden, stekkerScan, priveBezig, rol: x.rol === 'baas' || x.rol === 'werker' ? x.rol : null, kern: normaalAdres(x.kern, JARVIS_POORT), code: /^\d{6}$/.test(String(x.code || '')) ? String(x.code) : null, bekend: leesLeden(x.leden), ntfy: leesNtfy(x.ntfy), eigenaar: leesEigenaar(x.eigenaar), updateSleutel: leesUpdateSleutel(x.updateSleutel), updateRepo: typeof x.updateRepo === 'string' && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(x.updateRepo) && !x.updateRepo.includes('..') ? x.updateRepo : null, nieuweTelefoon: leesNieuweTelefoon(x.nieuweTelefoon) };
  }
  // 1.9.14: de downloadlink voor een nieuwe telefoon (QR "JARVIS op een nieuwe telefoon zetten"). Alleen een
  // ondertekend adres in de postbus (zelfde regel als de werker in JARVIS); al het andere: null.
  const POSTBUS_HOST = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.s3\.[a-z]{2}-[a-z]{3}\.scw\.cloud$/;
  function leesNieuweTelefoon(n) {
    if (!n || typeof n.apk !== 'string' || n.apk.length > 2000) return null;
    let u;
    try { u = new URL(n.apk); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !POSTBUS_HOST.test(u.hostname)) return null;
    const tot = typeof n.tot === 'string' && !Number.isNaN(Date.parse(n.tot)) ? n.tot : null;
    return { apk: u.href, tot };
  }
  // "Gekoppeld: telefoon A, rektelefoon 1" -- de namen in de volgorde van de lijst, zonder dubbele.
  function gekoppeldZin(telefoons) {
    const namen = [];
    for (const t of Array.isArray(telefoons) ? telefoons : []) { const n = String((t && t.naam) || '').trim(); if (n && !namen.includes(n)) namen.push(n); }
    return namen.length ? `Gekoppeld: ${namen.join(', ')}` : 'Nog niets gekoppeld.';
  }
  // Welke namen zijn er NIEUW bij (na een scan)? Op naam en adres.
  function nieuweNamen(oud, nieuw) {
    const al = new Set((oud || []).map((t) => t.adres));
    return (nieuw || []).filter((t) => !al.has(t.adres)).map((t) => t.naam);
  }
  // Hoe Veronica de eigenaar aanspreekt: de naam uit JARVIS (alleen met de code). Alleen letters.
  function leesEigenaar(n) {
    const t = String(n || '').replace(/[^\p{L} '-]/gu, '').trim().slice(0, 30);
    return t || null;
  }
  // 1.9.7: de LEESSLEUTEL van de privé updateplek van JARVIS (alleen lezen, een repo). Komt mee in
  // de lijst van de baas, alleen met de code. Alles wat er niet als een GitHub-token uitziet: null.
  const UPDATE_SLEUTEL_RE = /^(github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{36})$/;
  function leesUpdateSleutel(t) { return typeof t === 'string' && UPDATE_SLEUTEL_RE.test(t) ? t : null; }
  function leesNtfy(n) {
    if (!n || !Ntfy.geldigOnderwerp(n.onderwerp)) return null;
    return { onderwerp: n.onderwerp, aan: n.aan !== false, stil: Ntfy.STIL_KEUZES.includes(n.stil) ? n.stil : '23:00-07:00' };
  }
  // De vindladder van JARVIS (roddel): elk lid met zijn laatst bekende adressen. Veronica
  // onthoudt daarvan de JARVIS-adressen, nieuwste eerst. Alleen het eigen netwerk.
  const MAX_BEKEND = 16;
  function leesLeden(leden) {
    const uit = [];
    const lijst = (Array.isArray(leden) ? leden : []).slice(0, 24);
    for (let r = 0; r < 8; r++) {
      for (const l of lijst) {
        const a = l && Array.isArray(l.adressen) ? l.adressen[r] : null;
        if (!a) continue;
        const adres = normaalAdres(`${a.host}:${Number.isInteger(a.poort) ? a.poort : JARVIS_POORT}`, JARVIS_POORT);
        if (adres && !uit.includes(adres)) uit.push(adres);
      }
    }
    return uit.slice(0, MAX_BEKEND);
  }
  // Na een netwerkwissel vraagt Veronica rond: wie ze nu volgt, de hoofdtelefoon, elke
  // telefoon, en alles wat ze ooit hoorde. Uniek, in die volgorde.
  function rondvraagLijst(s) {
    const o = s || {};
    const uit = [];
    const zet = (a) => { if (a && !uit.includes(a)) uit.push(a); };
    zet(o.actieveKern); zet(o.kern);
    for (const t of o.telefoons || []) zet(t && t.jarvis);
    for (const a of o.bekend || []) zet(a);
    return uit;
  }
  // Onthouden: nieuwe adressen voorop, hoogstens MAX_BEKEND.
  function voegBekendToe(bekend, nieuw) {
    const uit = [];
    for (const a of (nieuw || []).concat(bekend || [])) { const n = normaalAdres(a, JARVIS_POORT); if (n && !uit.includes(n)) uit.push(n); }
    return uit.slice(0, MAX_BEKEND);
  }
  // Na een minuut niemand: zeg wat de mens kan doen (een keer scannen), zonder te gokken.
  function vindUitleg(i) {
    const o = i || {};
    if (!o.gekoppeld || o.bereikbaar > 0 || !(o.stilMs >= 60000)) return '';
    return `Ik vind niemand meer (${o.geprobeerd} adressen geprobeerd). Staan de telefoons aan en zit deze computer op hetzelfde wifi, het liefst de hotspot van de hoofdtelefoon? Lukt het niet: open op de baas Apparaten (daar staat de QR voor Veronica) en scan die een keer.`;
  }

  // 463b: een meter in gewone taal: "123 W · 230 V · totaal 4,56 kWh · vandaag 0,8 kWh". Alleen wat er staat.
  function meterZin(s) {
    const g = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const k = (v, n) => String(Math.round(v * 10 ** n) / 10 ** n).replace('.', ',');
    return [g(s.watt) !== null ? `${k(s.watt, 0)} W` : 'watt onbekend', g(s.spanning) !== null ? `${k(s.spanning, 0)} V` : null,
      g(s.kwh) !== null ? `totaal ${k(s.kwh, 2)} kWh` : null, g(s.vandaag) !== null ? `vandaag ${k(s.vandaag, 2)} kWh` : null].filter(Boolean).join(' · ');
  }
  // 467: verbruik en kosten. Tarief instelbaar (standaard 0,30 per kWh). Kosten = gemeten kWh x tarief; niets geschat.
  const TARIEF_STANDAARD = 0.30;
  function leesTarief(t) {
    const n = Number(String(t === undefined || t === null ? '' : t).trim().replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n <= 5 ? Math.round(n * 1000) / 1000 : TARIEF_STANDAARD;
  }
  const euro = (x) => `€ ${(Math.round(x * 100) / 100).toFixed(2).replace('.', ',')}`;
  // Een regel voor het verslag: "Nu 123 W · vandaag 0,80 kWh (€ 0,24) · totaal 4,56 kWh (€ 1,37) · tarief € 0,30 per kWh".
  function verbruikRegel(s, tarief) {
    const g = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
    const t = leesTarief(tarief);
    const kw = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
    const delen = [];
    if (g(s.watt) !== null) delen.push(`nu ${Math.round(s.watt)} W`);
    if (g(s.vandaag) !== null) delen.push(`vandaag ${kw(s.vandaag)} kWh (${euro(s.vandaag * t)})`);
    if (g(s.kwh) !== null) delen.push(`totaal ${kw(s.kwh)} kWh (${euro(s.kwh * t)})`);
    if (!delen.length) return 'Verbruik: onbekend (nog niet gemeten).';
    return `Verbruik: ${delen.join(' · ')} · tarief ${euro(t)} per kWh.`;
  }
  // 463b: wat de laatste zoekronde van de baas deed, in een zin.
  function scanZin(sc) {
    if (!sc) return 'De baas heeft nog niet naar stekkers gezocht (of hij is een oudere versie).';
    const net = sc.netten.length ? sc.netten.map((n) => `${n}.x`).join(' en ') : 'geen wifi';
    return `Laatste zoekronde van de baas: ${leeftijdZin(sc.leeftijdMs)} (${sc.door}): ${sc.gescand} adressen op ${net}, ${sc.antwoord} antwoordden, ${sc.tasmota} ${sc.tasmota === 1 ? 'is' : 'zijn'} Tasmota.`;
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
      spanning: meting(getal(e.Voltage), 'Tasmota Status 8', t),
      meet: status8 && status8.StatusSNS ? !!status8.StatusSNS.ENERGY : null,   // 463b: false = deze stekker meet niet
    };
  }
  // 1.9.13 (punt 7): "GEEN ANTWOORD" ZIJN TWEE VERSCHILLENDE DINGEN. Op 11 oktober was de telefoon er wel
  // (een andere poort weigerde binnen 22 ms), maar JARVIS antwoordde niet. Dat moet je anders oplossen
  // dan een telefoon die niet op het netwerk zit.
  //  hoofd: hoe de vraag aan JARVIS misging: 'traag' (geen antwoord binnen de tijd) of 'snel' (meteen fout);
  //  proef: een vraag aan een poort waar niets luistert ('snel' = het toestel is er, 'traag' = niets).
  function geenAntwoordZin(hoofd, proef) {
    if (hoofd === 'snel') return 'De telefoon is gevonden, maar JARVIS luistert daar niet. Open JARVIS op die telefoon. Staat hij wel aan, geef Chrome dan toegang tot het lokale netwerk (het slotje links van het adres).';
    if (proef === 'snel') return 'De telefoon is gevonden, maar JARVIS antwoordt niet. Open JARVIS op die telefoon en kijk op Apparaten bij "Bereikbaar voor Veronica".';
    return 'De telefoon is niet te vinden op dit netwerk. Staat hij aan, en zit hij op hetzelfde wifi als deze Chromebook?';
  }
  // Het adres van de proef: dezelfde telefoon, poort 8081 (daar luistert JARVIS nooit).
  function proefAdres(adres) {
    try { const u = new URL(adres); if (!/^https?:$/.test(u.protocol)) return null; u.port = '8081'; u.pathname = '/'; u.search = ''; return u.toString(); } catch (e) { return null; }
  }
  function leesQr(tekst) {
    let d;
    try { d = JSON.parse(String(tekst || '')); } catch (e) { return null; }
    if (!d || d.veronica !== 1) return null;
    // Sinds JARVIS 1.9.1: geen vaste code in de QR, alleen het adres en een EENMALIG token
    // (vijf minuten, een keer). Daarmee haalt Veronica de code en de lijst op.
    if (typeof d.t === 'string') {
      const kern = normaalAdres(d.kern, JARVIS_POORT);
      // Meer adressen (alt): dezelfde telefoon op het andere netwerk, en de anderen.
      const alt = (Array.isArray(d.alt) ? d.alt : []).slice(0, 6).map((a) => normaalAdres(a, JARVIS_POORT)).filter((a) => a && a !== kern);
      return kern && TOKEN_RE.test(d.t) ? { token: d.t, kern, alt: [...new Set(alt)], telefoons: [], stekkers: [], code: null } : null;
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

  // ---- 1.9.14: KOPPELEN VANAF VERONICA (12 oktober: "Veronica moet een QR code laten zien") ----
  // Veronica toont een QR met een EENMALIGE sleutel (128 bits toeval); JARVIS scant hem en vertrouwt de sleutel
  // vijf minuten op zijn eigen server. Daarna zoekt Veronica de telefoon zelf op haar eigen netwerk.
  // De sleutel gaat NOOIT over het netwerk: alleen een bewijs (HMAC over een willekeurig getal), en het antwoord
  // komt VERSLEUTELD terug (AES-GCM). Zelfde regels als JarvisWebServer.java; een test vergelijkt ze.
  const SLEUTEL_RE = /^[0-9a-f]{32}$/;
  const VERONICA_QR_MS = 5 * 60 * 1000;
  function veronicaQrTekst(s) { return SLEUTEL_RE.test(String(s || '')) ? JSON.stringify({ vk: 1, s }) : null; }
  // Een WebRTC-kandidaat ("candidate:... a.b.c.d ...") -> het eigen adres op het wifi, of null.
  function eigenAdresUitKandidaat(regel) {
    const ips = String(regel || '').match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g) || [];
    for (const ip of ips) if (ip.split('.').every((d) => +d <= 255) && isEigenNet(ip) && !/^127\./.test(ip) && !/^169\.254\./.test(ip)) return ip;
    return null;
  }
  // 1.9.17 (de eerste echte proef, 13 oktober): op een Chromebook gaf WebRTC het adres van de interne Android/Linux-laag
  // van ChromeOS (100.115.92.x) -- NIET het wifi van het huis. Daar staat de telefoon nooit. Dus: alleen echte
  // thuisnetten (192.168.x, 10.x, 172.16-31.x), alle gevonden adressen, en als vangnet de gangbare thuisnetten.
  // 449 (13 oktober, het echte huis): 192.168.68 is het standaardnet van een veelgebruikt mesh-systeem. Vooraan na .1: een
  // mesh is gewoon, en dan is dat het wifi waar de Chromebook en de telefoon op zitten.
  const GANGBARE_NETTEN = ['192.168.1', '192.168.68', '192.168.0', '192.168.2', '192.168.178', '10.0.0'];
  function isThuisNet(ip) {
    const d = String(ip || '').split('.').map(Number);
    if (d.length !== 4 || d.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
    return d[0] === 10 || (d[0] === 192 && d[1] === 168) || (d[0] === 172 && d[1] >= 16 && d[1] <= 31);
  }
  function thuisAdressenUitKandidaten(regels) {
    const uit = [];
    for (const r of regels || []) for (const ip of String(r || '').match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g) || []) if (isThuisNet(ip) && !uit.includes(ip)) uit.push(ip);
    return uit;
  }
  // Het zoekplan: eerst adressen die ze al kent, dan de eigen thuisnetten, dan de gangbare (vangnet). gok = er was
  // geen eigen thuisnet; dan zegt ze dat ook.
  function zoekPlan(eigen, bekend) {
    const eigenNetten = [];
    for (const ip of eigen || []) { const n = ip.split('.').slice(0, 3).join('.'); if (isThuisNet(ip) && !eigenNetten.includes(n)) eigenNetten.push(n); }
    const netten = eigenNetten.concat(GANGBARE_NETTEN.filter((n) => !eigenNetten.includes(n)));
    const adressen = [];
    const voeg = (a) => { if (a && !adressen.includes(a)) adressen.push(a); };
    for (const a of bekend || []) { const x = normaalAdres(a, JARVIS_POORT); if (x && isThuisNet(x.slice(7).split(':')[0])) voeg(x); }
    for (const n of netten) {
      const mijn = (eigen || []).find((ip) => ip.startsWith(n + '.'));
      for (const a of subnetAdressen(mijn || `${n}.0`)) voeg(a);
    }
    return { eigenNetten, netten, adressen, gok: !eigenNetten.length };
  }
  function zoekZin(plan) {
    const lijst = (ns) => ns.map((n) => `${n}.x`).join(', ');
    return plan.gok
      ? `Ik zie het wifi van deze computer niet (alleen het interne net van ChromeOS). Ik zoek de telefoon op de gangbare thuisnetten (${lijst(plan.netten)})…`
      : `Ik zoek de telefoon op je wifi (${lijst(plan.eigenNetten)}), en daarna op de gangbare thuisnetten…`;
  }
  const NOG_NIET_ZIN = 'Nog niet gevonden. Kijk op de telefoon: staat wifi aan, op hetzelfde netwerk als deze computer? En staat in JARVIS bij Apparaten "Bereikbaar voor Veronica: ja"? Ik blijf zoeken. Weet je het adres van de telefoon (JARVIS, Apparaten), dan mag je het hieronder invullen.';
  // 13 oktober (startklaar voor het rek): WAT ER OP HET KOPPELSCHERM STAAT terwijl Veronica zoekt. EEN plek, zodat
  // elke manier van vastlopen een eigen, gewone zin krijgt in plaats van "Ik maak verbinding..." zonder einde.
  // o: { msSinds, plan, briefAdressen: [...], briefMsSinds, briefFouten, online, toestemming }
  // Terug: { zin, adresVeld } -- adresVeld = het veld voor het adres met de hand tonen.
  const GEEN_LNA_ZIN = 'Chrome laat Veronica de telefoon niet bereiken: toegang tot het lokale netwerk staat uit. Klik links van het adres op het slotje, dan Site-instellingen, en zet "Lokaal netwerk" op Toestaan. Laad de pagina daarna opnieuw.';
  const BRIEF_WACHT_MS = 15000, ZOEK_LANG_MS = 30000, BRIEF_FOUTEN = 3;
  // 449: het versienummer van Veronica, zichtbaar op Koppelen (zo is te zien dat de nieuwe er is).
  const VERONICA_VERSIE = '1.9.32';
  // 460: de ENE officiele plek waar OlliteRT vandaan komt (gratis, Apache 2.0). Veronica toont er een QR van; er wordt niets gedownload.
  const OLLITERT_PAGINA = 'https://github.com/NightMean/OlliteRT/releases/latest';
  const WACHT_ZIN = 'Scan deze QR met JARVIS (de knop Koppel met Veronica). De telefoon geeft daarna zelf zijn adres door; ik wacht daarop en raad niets.';
  function koppelStand(i) {
    const o = i || {};
    const brief = (o.briefAdressen || []).length > 0;
    if (o.toestemming === 'denied') return { zin: GEEN_LNA_ZIN, adresVeld: false };
    if (brief && o.briefMsSinds >= BRIEF_WACHT_MS) {
      const adres = String(o.briefAdressen[0]).replace(/^http:\/\//, '');
      // 449: de telefoon zit op een ANDER net dan deze computer (router plus mesh). Dan helpt zoeken niet: zeg het.
      const eigen = (o.eigenNetten || []).filter(Boolean);
      const telNetten = o.briefAdressen.map(netVan).filter(Boolean);
      if (eigen.length && telNetten.length && !telNetten.some((n) => eigen.includes(n))) {
        return { zin: `De telefoon zit op een ANDER netwerk (${telNetten[0]}.x) dan deze computer (${eigen[0]}.x). Dat gebeurt vaak met een router en een mesh-systeem met elk een eigen wifi. Zet de telefoon op HETZELFDE wifi als deze computer (kijk bij Wifi op allebei welke naam er staat), en scan dan opnieuw.`, adresVeld: true, anderNet: true };
      }
      return { zin: `De telefoon gaf zijn adres door (${adres}), maar ik kom er niet bij. Kijk na: zit deze computer op HETZELFDE wifi als de telefoon (geen gastnetwerk)? Vroeg Chrome om het lokale netwerk? Dan Toestaan. Staat in JARVIS bij Apparaten "Bereikbaar voor Veronica: ja"? Ik blijf het proberen.`, adresVeld: true };
    }
    if (brief) return { zin: 'De telefoon heeft zijn adres doorgegeven. Ik maak verbinding...', adresVeld: false };
    const lang = o.msSinds >= ZOEK_LANG_MS;
    if (o.online === false) {
      return { zin: `Deze computer heeft geen internet, dus de telefoon kan zijn adres niet doorgeven. Ik zoek hem zelf op het wifi.${lang ? ' Weet je het adres van de telefoon (JARVIS, Apparaten), vul het dan hieronder in.' : ''}`, adresVeld: lang };
    }
    // 449: ZONDER "Zoek zelf" raadt Veronica niets (het raden verstopte in het echte huis de browser, en dan kwam de
    // brievenbus niet meer door). Dan zegt ze waar ze op wacht.
    if (!lang) return { zin: o.zelfZoeken ? zoekZin(o.plan || { gok: true, netten: [] }) : WACHT_ZIN, adresVeld: false };
    const voor = o.briefStand === 'druk'
      ? 'De brievenbus op internet (ntfy.sh) krijgt nu te veel vragen vanaf dit internetadres; ik wacht even en kijk dan opnieuw. Ik zoek intussen zelf. '
      : o.briefFouten >= BRIEF_FOUTEN
      ? 'De brievenbus op internet (ntfy.sh) is nu niet te bereiken, dus ik zoek zelf. '
      : 'Nog geen bericht van de telefoon. Heeft JARVIS de QR gescand en zei hij "Veronica mag nu koppelen"? Zo niet: scan opnieuw. ';
    if (!o.zelfZoeken) return { zin: `${voor}Lukt het niet? Tik op "Zoek zelf", of vul het adres van de telefoon hieronder in (JARVIS, Apparaten).`, adresVeld: true };
    return { zin: voor + NOG_NIET_ZIN, adresVeld: true };
  }
  // 449: het /24-net van een adres ("http://a.b.c.d:8080" of "a.b.c.d" -> "a.b.c"), of null.
  function netVan(adres) {
    const m = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}/.exec(String(adres || ''));
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
  }
  // Alle adressen in hetzelfde /24-net, behalve het eigen, op poort 8080 -- de dichtstbijzijnde eerst.
  function subnetAdressen(ip) {
    if (!ip || !isEigenNet(ip)) return [];
    const d = ip.split('.').map(Number), eigen = d[3], uit = [];
    for (let x = 1; x <= 254; x++) if (x !== eigen) uit.push(x);
    uit.sort((a, b) => Math.abs(a - eigen) - Math.abs(b - eigen) || a - b);
    return uit.map((x) => `http://${d[0]}.${d[1]}.${d[2]}.${x}:${JARVIS_POORT}`);
  }
  const hexNaar = (h) => new Uint8Array(String(h).match(/../g).map((x) => parseInt(x, 16)));
  const naarHex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  const tekstBytes = (t) => new TextEncoder().encode(t);
  function cryptoNu(c) { return c || (typeof crypto !== 'undefined' ? crypto : null); }
  function nieuweSleutel(c) { const b = new Uint8Array(16); cryptoNu(c).getRandomValues(b); return naarHex(b); }
  // Het bewijs dat Veronica de sleutel kent, zonder hem te sturen: HMAC-SHA256(sleutel, "veronica-koppel:" + n).
  async function veronicaBewijs(s, n, c) {
    const sub = cryptoNu(c).subtle;
    const k = await sub.importKey('raw', hexNaar(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return naarHex(await sub.sign('HMAC', k, tekstBytes('veronica-koppel:' + n)));
  }
  // Het antwoord van de telefoon openen: AES-GCM met SHA-256("veronica-sleutel:" + sleutel). Geen sleutel = onleesbaar.
  async function veronicaOpen(s, iv, data, c) {
    const sub = cryptoNu(c).subtle;
    const raw = await sub.digest('SHA-256', tekstBytes('veronica-sleutel:' + s));
    const k = await sub.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    return new TextDecoder().decode(await sub.decrypt({ name: 'AES-GCM', iv: hexNaar(iv) }, k, hexNaar(data)));
  }

  // ---- DE BRIEVENBUS (13 oktober): het adres van de telefoon, zonder raden ----
  // Na de scan legt JARVIS zijn eigen adres op het wifi versleuteld klaar op ntfy.sh (koppel.js, briefVerzoek).
  // Het onderwerp is een hash van de sleutel uit de QR, de inhoud is versleuteld met diezelfde sleutel. Zo
  // vindt Veronica de telefoon ook als deze computer zijn eigen wifi niet kan zien (Chromebook).
  const BRIEF_SERVER = 'https://ntfy.sh';
  async function briefOnderwerp(s, c) {
    return 'vb' + naarHex(await cryptoNu(c).subtle.digest('SHA-256', tekstBytes('veronica-brief:' + s))).slice(0, 30);
  }
  // 449: EEN doorlopende verbinding voor ALLE onderwerpen tegelijk (ntfy: "a,b"), in plaats van elke vier seconden
  // vragen. ntfy.sh staat ongeveer 12 vragen per minuut per internetadres toe, en de telefoon thuis deelt dat adres:
  // met vragen kreeg Veronica na een paar minuten "429" -- en de telefoon kon zijn eigen brief niet meer kwijt.
  const briefStroomUrl = (onderwerpen, sindsS) => `${BRIEF_SERVER}/${onderwerpen.join(',')}/json?since=${Math.max(0, Math.floor(sindsS))}`;
  const briefPollUrl = (onderwerp, sindsS) => `${BRIEF_SERVER}/${onderwerp}/json?poll=1&since=${Math.max(0, Math.floor(sindsS))}`;
  // De regels van ntfy (een JSON-bericht per regel) -> de adressen ("http://a.b.c.d:poort"), alleen op een
  // thuisnet. Een bericht dat niet met deze sleutel open gaat, telt niet.
  async function leesBrief(s, tekst, c) {
    const uit = [];
    for (const regel of String(tekst || '').split('\n')) {
      let m;
      try { m = JSON.parse(regel); } catch (e) { continue; }
      let b, d;
      try { b = JSON.parse(m.message); d = JSON.parse(await veronicaOpenMet(s, b.iv, b.data, 'veronica-adres:', c)); } catch (e) { continue; }
      const poort = Number(d && d.p) || JARVIS_POORT;
      for (const ip of (d && Array.isArray(d.a) ? d.a : [])) {
        const a = `http://${ip}:${poort}`;
        if (isThuisNet(String(ip)) && !uit.includes(a)) uit.push(a);
      }
    }
    return uit;
  }
  async function veronicaOpenMet(s, iv, data, voor, c) {
    const sub = cryptoNu(c).subtle;
    const raw = await sub.digest('SHA-256', tekstBytes(voor + s));
    const k = await sub.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    return new TextDecoder().decode(await sub.decrypt({ name: 'AES-GCM', iv: hexNaar(iv) }, k, hexNaar(data)));
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
  // 450 (het echte huis, 18:55): de baas zette ZICHZELF in zijn lijst op een adres van een tweede verbinding (10.x)
  // in plaats van op het wifi. Veronica bereikte hem wel op het wifi-adres. Regel: het adres waarop de baas BEWEZEN
  // antwoordde wint van wat hij over zichzelf zegt. Alleen voor de baas zelf (kern); andere telefoons ongemoeid.
  function herstelKernAdres(telefoons, bewezen) {
    const m = /^http:\/\/([^:/]+)/.exec(String(bewezen || ''));
    if (!m) return telefoons || [];
    const host = m[1];
    const zet = (adres) => String(adres || '').replace(/^http:\/\/[^:/]+/, `http://${host}`);
    return (telefoons || []).map((t) => (t && t.kern && !String(t.jarvis || '').startsWith(`http://${host}:`)
      ? Object.assign({}, t, { adres: zet(t.adres), jarvis: zet(t.jarvis), hersteld: true }) : t));
  }
  function lnaUitleg(i) {
    const o = i || {};
    const terug = 'Zet het terug: klik links van het adres op het slotje, dan Site-instellingen, en zet "Lokaal netwerk" op Toestaan. Laad de pagina daarna opnieuw.';
    if (o.toestemming === 'denied') return `Chrome laat Veronica de telefoons niet bereiken: toegang tot het lokale netwerk is geweigerd. ${terug}`;
    if (o.online && o.aantal > 0 && o.bereikbaar === 0 && o.stilMs >= 30000) {
      // 450: de baas antwoordt WEL (stand.json), alleen zijn rekentelefoons niet: dan ligt het niet aan Chrome.
      if (typeof o.baasMs === 'number' && o.baasMs < 30000) {
        return 'De baas antwoordt, maar de rekentelefoons niet op het adres dat hij doorgeeft. Werk JARVIS bij op de baas en de telefoons (1.9.20 of nieuwer), en kijk of wifi aan staat op elke telefoon.';
      }
      return o.toestemming === 'granted'
        ? 'Geen enkele telefoon antwoordt. Staan ze aan, staat JARVIS open, en zitten ze op hetzelfde wifi als deze computer?'
        : `Geen enkele telefoon antwoordt. Staan ze aan en op hetzelfde wifi? Heeft Chrome gevraagd om het lokale netwerk en zei je nee, dan: ${terug}`;
    }
    return '';
  }


  // ---- WAARSCHUWEN (ntfy): dezelfde regels als JARVIS (www/waarschuw.js; een test vergelijkt ze) ----
  // Het geheime onderwerp komt van de hoofdtelefoon (met de code); het staat niet in deze code.
  const Ntfy = (function () {

    const SERVER = 'https://ntfy.sh';
    const REM_MS = 15 * 60 * 1000;
    const ONDERWERP_RE = /^jv[a-z0-9]{30}$/;
    const SOORTEN = {
      heet: { prio: 4, tag: 'thermometer' },
      weg: { prio: 3, tag: 'warning' },
      noodstop: { prio: 5, tag: 'rotating_light' },
      accu: { prio: 3, tag: 'battery' },
      stil: { prio: 3, tag: 'zzz' },
      proef: { prio: 2, tag: 'white_check_mark' },
    };
    const STIL_KEUZES = ['uit', '22:00-08:00', '23:00-07:00'];

    // 32 tekens: "jv" en 30 uit a-z0-9, uit echte toevalsbytes (crypto.getRandomValues).
    function maakOnderwerp(bytes) {
      const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
      if (!bytes || bytes.length < 30) throw new Error('toeval nodig');
      let t = 'jv';
      for (let i = 0; i < 30; i++) t += abc[bytes[i] % 36];
      return t;
    }
    const geldigOnderwerp = (t) => ONDERWERP_RE.test(String(t || ''));

    // Geen IP-adres, geen e-mailadres, geen poort; kort.
    function schoon(tekst) {
      return String(tekst || '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, '')
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '')
        .replace(/\s*\(\s*\)/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 200);
    }

    // Stille uren: "23:00-07:00" (over middernacht) of "uit".
    function inStilleUren(datum, stil) {
      const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(stil || ''));
      if (!m) return false;
      const min = datum.getHours() * 60 + datum.getMinutes();
      const van = Number(m[1]) * 60 + Number(m[2]);
      const tot = Number(m[3]) * 60 + Number(m[4]);
      return van <= tot ? min >= van && min < tot : min >= van || min < tot;
    }
    function prioriteit(soort, dringend, stil) {
      if (dringend || soort === 'noodstop') return 5;
      if (stil) return 1;
      return (SOORTEN[soort] || SOORTEN.weg).prio;
    }

    // De rem. laatst = { soort: ms } van deze afzender; recent = de soorten die de laatste
    // vijftien minuten al op het onderwerp stonden (van wie dan ook). Een proef mag altijd.
    function magSturen(i) {
      const o = i || {};
      if (!geldigOnderwerp(o.onderwerp)) return { mag: false, reden: 'geen onderwerp (koppel eerst met de hoofdtelefoon)' };
      if (o.uit) return { mag: false, reden: 'waarschuwen staat uit' };
      if (!SOORTEN[o.soort]) return { mag: false, reden: 'onbekende soort' };
      if (o.soort === 'proef') return { mag: true, reden: 'proef' };
      const t = o.laatst && o.laatst[o.soort];
      if (typeof t === 'number' && o.nu - t < REM_MS) return { mag: false, reden: `rem: ${o.soort} al gemeld (${Math.round((o.nu - t) / 60000)} min geleden)` };
      if (o.recent && o.recent.has && o.recent.has(o.soort)) return { mag: false, reden: `rem: ${o.soort} staat er al (van een ander)` };
      return { mag: true, reden: '' };
    }

    // Het verzoek: JSON naar de server (ntfy "publish as JSON"). Zonder Content-Type-kop, zodat
    // een browser (Veronica) geen CORS-voorvraag hoeft te doen.
    function verzoek(o) {
      const s = SOORTEN[o.soort] || SOORTEN.weg;
      return {
        method: 'POST',
        url: SERVER,
        data: JSON.stringify({
          topic: o.onderwerp,
          title: o.titel || 'JARVIS',
          message: schoon(o.tekst),
          priority: prioriteit(o.soort, o.dringend, o.stil),
          tags: [s.tag, `soort-${o.soort}`],
        }),
      };
    }
    const pollUrl = (onderwerp) => `${SERVER}/${onderwerp}/json?poll=1&since=15m`;
    // De ntfy-geschiedenis (een JSON-bericht per regel): welke soorten stonden er al?
    function leesRecent(tekst) {
      const uit = new Set();
      for (const r of String(tekst || '').split('\n')) {
        let d;
        try { d = JSON.parse(r); } catch (e) { continue; }
        if (!d || d.event !== 'message' || !Array.isArray(d.tags)) continue;
        for (const t of d.tags) { const m = /^soort-([a-z]+)$/.exec(String(t)); if (m) uit.add(m[1]); }
      }
      return uit;
    }
    // Abonneren op je telefoon: de ntfy-app opent dit adres en vraagt "abonneren?".
    const abonneerLink = (onderwerp) => (geldigOnderwerp(onderwerp) ? `ntfy://ntfy.sh/${onderwerp}` : null);

    return { SERVER, REM_MS, SOORTEN, STIL_KEUZES, maakOnderwerp, geldigOnderwerp, schoon, inStilleUren, prioriteit, magSturen, verzoek, pollUrl, leesRecent, abonneerLink };
  }());

  // ---- SPRAAK (1.9.4): wat Veronica verstaat, zonder AI ----
  // Vaste opdrachten met vaste woorden. Al het andere is een vraag voor de rij. Een noodstop
  // vraagt altijd eerst "ja"; zonder bevestiging gebeurt er niets.
  function begrijp(tekst) {
    const t = String(tekst || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^(he|hey|hoi|hallo|ok|oke)?\s*veronica\b\s*/, '').trim();
    if (!t) return { soort: 'leeg', tekst: '' };
    if (/^(ja|jazeker|ja graag|doe maar|bevestig|bevestigd)$/.test(t)) return { soort: 'ja', tekst: t };
    if (/^(nee|niet|stop maar|laat maar|annuleer|annuleren)$/.test(t)) return { soort: 'nee', tekst: t };
    if (/\b(noodstop|alles stoppen|stop alles|alles stop)\b/.test(t)) return { soort: 'noodstop', tekst: t };
    if (/\b(roep|oproepen|wek)\b.*\b(rij|iedereen|telefoons|ze)\b|\brij oproepen\b/.test(t)) return { soort: 'roep', tekst: t };
    if (/\bwandstand\b.*\b(uit|weg|stop)\b|\b(stop|sluit)\b.*\bwandstand\b/.test(t)) return { soort: 'wand-uit', tekst: t };
    if (/\bwandstand\b|\bvolledig scherm\b/.test(t)) return { soort: 'wand-aan', tekst: t };
    if (/\b(status|rapport)\b|^(stand|hoe gaat het|hoe staat het( ervoor)?|alles goed|hoe is het)\b/.test(t)) return { soort: 'status', tekst: t };
    return { soort: 'vraag', tekst: String(tekst || '').replace(/^\s*(h[eé]y?|hoi|hallo|ok[eé]?)?\s*veronica[\s,!.:]*/i, '').trim() };
  }
  // Mag ze NU hardop praten? Spraak aan, en in de stille uren (dezelfde als ntfy) alleen een
  // noodstop of ROOD.
  function magSpreken(o) {
    const x = o || {};
    if (!x.aan) return false;
    if (x.stil && !['noodstop', 'rood'].includes(x.soort)) return false;
    return true;
  }
  // 16 kHz mono, 16 bits: WAV voor de Gemma (OlliteRT /v1/audio/transcriptions).
  function wavVan(monster, rate) {
    const n = monster.length;
    const b = new ArrayBuffer(44 + n * 2);
    const v = new DataView(b);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    s(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, monster[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Uint8Array(b);
  }
  const dagdeel = (uur) => (uur < 6 ? 'Goedenavond' : uur < 12 ? 'Goedemorgen' : uur < 18 ? 'Goedemiddag' : 'Goedenavond');
  // De stand in een paar korte zinnen (feiten uit de metingen, niets geraden).
  function statusFeiten(i) {
    const o = i || {};
    const zinnen = [`${o.bereikbaar} van ${o.totaal} ${o.totaal === 1 ? 'telefoon' : 'telefoons'} bereikbaar.`];
    if (o.warmste) zinnen.push(`Warmste: ${o.warmste.naam}, ${String(Math.round(o.warmste.temp * 10) / 10).replace('.', ',')} graden.`);
    if (o.wacht) zinnen.push(`${o.wacht} ${o.wacht === 1 ? 'vraag wacht' : 'vragen wachten'}.`);
    if (o.heet) zinnen.push(`${o.heet} te warm.`);
    return zinnen.join(' ');
  }

  // ---- De prestatiekaart: rol, en hoe oud de laatste meting is ----
  // Dezelfde woorden als JARVIS (PLEK_NAAM in app.js); de test vergelijkt ze.
  const PLEK_NAAM = { mobiel: '👖 Mobiel (kern)', rek: '🧊🔌 Rek (helper)' };
  // 1.9.21 (451): VAN BAAS WISSELEN met een knop. Alleen een telefoon met JARVIS (t.jarvis) kan baas worden; de lijst
  // houdt precies EEN kern. Een onbekend adres verandert niets.
  function wisselKern(telefoons, adres) {
    const lijst = Array.isArray(telefoons) ? telefoons : [];
    const doel = lijst.find((t) => t && t.adres === adres);
    if (!doel || !doel.jarvis) return lijst;
    return lijst.map((t) => Object.assign({}, t, { kern: t.adres === adres }));
  }
  function rolZin(t, status, tijd) {
    const r = status && status.rol && tijd - status.rol.t <= MAX_LEEFTIJD_MS ? status.rol.waarde : null;
    const delen = [];
    if (r === 'baas') delen.push('👑 Baas');
    else if (r === 'werker') delen.push('Werker');
    if (t && PLEK_NAAM[t.plek]) delen.push(PLEK_NAAM[t.plek]);
    return delen.join(' · ') || 'rol onbekend';
  }
  // 1.9.14 (stap a, 12 oktober): HET REK IN EEN OOGOPSLAG. Elke rektelefoon ligt op een eigen ventilator;
  // hier is te zien of dat genoeg koelt. Per rektelefoon de temperatuur en de accu (alleen verse metingen), en een zin.
  // De grenzen zijn die van de ventilator in JARVIS: aan vanaf 35 graden; vanaf 38 is het te warm.
  const REK_WARM = 35, REK_HEET = 38;
  // 1.9.14: de reserve (de schuif): 30 of 50, standaard 50. Zelfde getallen als stroom.js in JARVIS.
  const RESERVES = [30, 50];
  function reserveZin(r) {
    return r === 30 ? 'Stopt met rekenen bij 30%. De rest is voor de nacht. Meer rekenen, minder reserve: alleen met een goede accu.'
      : 'Stopt met rekenen bij 50%. De rest is voor de nacht.';
  }
  function rekOverzicht(rij, maxMs) {
    const rek = (rij || []).filter((r) => r && r.plek === 'rek');
    if (!rek.length) return null;
    const getal = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
    const regels = rek.map((r) => {
      const temp = typeof r.temp === 'number' && r.tempMs !== null && r.tempMs <= maxMs ? r.temp : null;
      const accu = typeof r.accu === 'number' && r.accuMs !== null && r.accuMs <= maxMs ? Math.round(r.accu) : null;
      const stand = temp === null ? 'onbekend' : temp >= REK_HEET ? 'heet' : temp >= REK_WARM ? 'warm' : 'koel';
      return { naam: r.naam, temp, accu, stand,
        tekst: `${r.naam} · ${temp === null ? 'temperatuur onbekend' : `${getal(temp)} °C`} · ${accu === null ? 'accu onbekend' : `🔋 ${accu}%${r.laadt ? ' (laadt)' : ''}`}${r.rust === true ? ' · 😴 rust tot de zon' : r.rust === false ? ' · ⚙️ rekent' : ''}${/^\d+\.\d+\.\d+$/.test(String(r.versie || '')) ? ` · JARVIS ${r.versie}` : ''}` };
    });
    const gemeten = regels.filter((r) => r.temp !== null).sort((a, b) => b.temp - a.temp);
    if (!gemeten.length) return { stand: 'onbekend', zin: 'Rek: nog geen temperatuur gemeten.', regels };
    const w = gemeten[0];
    if (w.temp >= REK_HEET) return { stand: 'heet', zin: `Rek te warm: ${w.naam} is ${getal(w.temp)} °C. De ventilator koelt niet genoeg.`, regels };
    if (w.temp >= REK_WARM) return { stand: 'warm', zin: `Rek wordt warm: ${w.naam} is ${getal(w.temp)} °C. De ventilator hoort nu aan te staan.`, regels };
    return { stand: 'koel', zin: `Rek koel genoeg: de warmste is ${getal(w.temp)} °C.`, regels };
  }
  // De nieuwste meting van OlliteRT (snelheid en benutting: het hart van de kaart), of null als
  // er nooit een was. Een batterij die JARVIS nog meldt, maakt een stille OlliteRT niet vers.
  function jongsteMeting(m) {
    let j = typeof (m && m.gezien) === 'number' ? m.gezien : null;
    for (const v of Object.values((m && m.health) || {})) if (v && typeof v.t === 'number' && (j === null || v.t > j)) j = v.t;
    return j;
  }
  // '' = vers; anders de zin voor een grijze kaart.
  function oudZin(jongste, tijd) {
    if (jongste === null || jongste === undefined) return 'nog geen meting';
    const ms = tijd - jongste;
    return ms > MAX_LEEFTIJD_MS ? `laatste meting ${leeftijdZin(ms)}` : '';
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
    const rustPer = {};                       // 1.9.14: naam -> true (rust tot de zon) / false (rekent)
    const handPer = {};                       // 1.9.15: stekkernaam -> 'auto' | 'aan' | 'uit' (de handknop)
    for (const s of Array.isArray(d.stekkers) ? d.stekkers : []) if (s && tekst(s.naam) && ['auto', 'aan', 'uit'].includes(s.hand)) handPer[tekst(s.naam)] = s.hand;
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
    // 463b: wat de BAAS aan elke stekker meet (Veronica kan een stekker niet altijd zelf lezen: dat mag alleen met CORS). Per naam.
    const stekkerPer = {};
    for (const s of Array.isArray(d.stekkers) ? d.stekkers : []) {
      if (!s || !tekst(s.naam) || bij(s.leeftijdMs) === null) continue;
      stekkerPer[tekst(s.naam)] = { t: bij(s.leeftijdMs), aan: s.aan === true ? true : s.aan === false ? false : null, watt: g(s.watt), kwh: g(s.kwh), vandaag: g(s.vandaag), spanning: g(s.spanning), meet: s.meet === false ? false : s.meet === true ? true : null };
    }
    // De meter(s): het totale verbruik, ALS GEMETEN WAARDE met bron en leeftijd. Meet de stekker niet, dan staat dat er duidelijk.
    for (const s of Array.isArray(d.stekkers) ? d.stekkers : []) {
      if (!s || s.rol !== 'meter') continue;
      rijen.push({ label: `Verbruik: ${tekst(s.naam) || 'meter'}`, m: bij(s.leeftijdMs) === null ? null
        : meting(s.meet === false ? 'deze stekker meet niet' : meterZin(s), 'Tasmota Status 8, via de hoofdtelefoon', bij(s.leeftijdMs)) });
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
      if (typeof t.rust === 'boolean' && tekst(t.naam)) rustPer[tekst(t.naam)] = t.rust;
      if (tekst(t.accu)) rijen.push({ label: `Accu ${icoon}${tekst(t.naam) || ''}`, m: meting(`${tekst(t.accu)}${tekst(t.zon) ? ` · ${tekst(t.zon)}` : ''}`, t.plek === 'mobiel' ? 'eigen metingen, via de hoofdtelefoon (mobiel: apart)' : 'eigen metingen, via de hoofdtelefoon', ontvangen) });
      rijen.push({ label: `${icoon}${tekst(t.naam) || 'telefoon'}`, m: bij(t.leeftijdMs) === null ? null
        : meting(`${g(t.procent) !== null ? `${t.procent}%` : '% onbekend'} · ${t.laadt === true ? 'laadt' : t.laadt === false ? 'laadt niet' : 'laden onbekend'} · ${g(t.temperatuur) !== null ? graad(t.temperatuur) : 'temperatuur onbekend'}`, `${tekst(t.bron) || 'JARVIS'}, via de hoofdtelefoon`, bij(t.leeftijdMs)) });
    }
    if (tekst(d.accuRek)) rijen.push({ label: 'Accu rek samen', m: meting(tekst(d.accuRek), 'eigen metingen, via de hoofdtelefoon', ontvangen) });
    const st = d.staaf;
    const staaf = st && g(st.zon) !== null && g(st.buiten) !== null
      ? meting({ zon: st.zon, buiten: st.buiten, onbekend: g(st.onbekend) || 0 }, `${tekst(st.bron) || 'Tasmota'}, via de hoofdtelefoon`, ontvangen) : null;
    return { rijen, staaf, accuPer, rustPer, handPer, stekkerPer, reserve: RESERVES.includes(d.reserve) ? d.reserve : null, geenZon: d.geenZon === true, zon: zonStand };
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
      case 'begroeting': return hd
        ? `${dagdeel(x.uur)}${x.naam ? `, ${x.naam}` : ''}. Ik ben er. ${x.feiten || ''}`.trim()
        : `Veronica gestart. ${x.feiten || ''}`.trim();
      case 'status': return hd
        ? `${x.rustig ? 'Alles rustig' : 'Ik let op'}${x.naam ? `, ${x.naam}` : ''}. ${x.feiten || ''}`.trim()
        : (x.feiten || '');
      case 'luister': return hd ? 'Ja?' : 'Ik luister.';
      case 'nietVerstaan': return hd ? 'Dat verstond ik niet. Zeg het nog eens, kort.' : 'Niet verstaan.';
      case 'noodstopVraag': return hd ? 'Noodstop? Zeg ja, of tik op Bevestig. Anders doe ik niets.' : 'Noodstop: bevestig met ja.';
      case 'noodstopAf': return hd ? 'Geen noodstop. Alles loopt door.' : 'Noodstop geannuleerd.';
      case 'vraagInRij': return hd ? 'Je vraag staat in de rij. Ik lees het antwoord voor.' : 'Vraag in de rij.';
      case 'vraagWacht': return hd ? 'Je vraag staat in de rij. Het pantser staat uit, dus hij wacht.' : 'Vraag in de rij; pantser uit.';
      case 'roepOp': return hd ? `Rij opgeroepen. ${x.ja} ${x.ja === 1 ? 'meldde zich' : 'meldden zich'}.${x.nee ? ` ${x.nee} niet.` : ''}` : `Opgeroepen: ${x.ja} ja, ${x.nee || 0} nee.`;
      case 'wandAan': return hd ? 'Wandstand. Ik hou ze in de gaten.' : 'Wandstand aan.';
      case 'wandUit': return hd ? 'Wandstand uit.' : 'Wandstand uit.';
      case 'online': return hd ? 'Geen Gemma vrij om te luisteren. Ik luister via Google. Dat gaat online.' : 'Luisteren via Google (online).';
      case 'accu': return hd ? `${x.naam} heeft nog ${x.procent}% accu en laadt niet. Hij krijgt geen nieuw werk.` : `${x.naam}: ${x.procent}% accu, laadt niet.`;
      case 'stil': return hd ? 'De rij ligt al tien minuten stil. Er wacht werk, niemand pakt het op.' : 'Rij stil: werk wacht, niemand bezig (10 min).';
      case 'proef': return hd ? 'Dit is een proef van Veronica. Zo ziet een waarschuwing eruit.' : 'Proefmelding van Veronica.';
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

  // 457: ZWIJGT HET OLLITERT-ADRES, MAAR ANTWOORDT JARVIS? Dan is het adres meestal oud (hotspot, ander wifi). Kandidaten, in volgorde:
  // wat de telefoon zelf meldt (verse JARVIS), de host waar JARVIS wel antwoordt met poort 8000, en wat de baas nog van hem wist.
  function alternatieveAdressen(t, status) {
    const uit = [];
    const voeg = (a) => { const n = normaalAdres(a, OLLITERT_POORT); if (n && n !== t.adres && !uit.includes(n)) uit.push(n); };
    const gemeld = status && status.adressen && Array.isArray(status.adressen.waarde) ? status.adressen.waarde : [];
    gemeld.forEach(voeg);
    const m = /^http:\/\/([^:/]+)/.exec(String(t.jarvis || ''));
    if (m) voeg(`http://${m[1]}:${OLLITERT_POORT}`);
    (Array.isArray(t.alternatieven) ? t.alternatieven : []).forEach(voeg);
    return uit.slice(0, 6);
  }
  return {
    alternatieveAdressen, leesMotor, motorZin, motorAdres, MOTOR_FASEN, leesAikern, kernZin, begrijp, magSpreken, wavVan, dagdeel, statusFeiten, leesEigenaar, PLEK_NAAM, rolZin, jongsteMeting, oudZin, Ntfy, leesNtfy, KARAKTERS, veronicaZin, baasUitStatus, lnaUitleg, herstelKernAdres, wisselKern, JARVIS_NIEUWSTE, vergelijkVersie, nieuwsteVersie, versieZin, leesLeden, rondvraagLijst, voegBekendToe, vindUitleg, MAX_BEKEND,
    leesZonStroom, leesPakket, koppelQrTekst, leesUpdateSleutel,
    SLEUTEL_RE, VERONICA_QR_MS, veronicaQrTekst, BRIEF_SERVER, briefOnderwerp, briefPollUrl, briefStroomUrl, netVan, leesBrief, eigenAdresUitKandidaat, subnetAdressen, nieuweSleutel, veronicaBewijs, veronicaOpen,
    MAX_LEEFTIJD_MS, JARVIS_POORT, OLLITERT_POORT, HITTE,
    meting, vakje, leeftijdZin, klokZin, leesHealth, leesStatus, leesStekker, meterZin, leesTarief, verbruikRegel, TARIEF_STANDAARD, scanZin, hitteNaam, ruweStand,
    isEigenNet, normaalAdres, leesVertrouwd, leesNieuweTelefoon, gekoppeldZin, nieuweNamen, GANGBARE_NETTEN, isThuisNet, thuisAdressenUitKandidaten, zoekPlan, zoekZin, NOG_NIET_ZIN, koppelStand, GEEN_LNA_ZIN, BRIEF_WACHT_MS, VERONICA_VERSIE, OLLITERT_PAGINA, WACHT_ZIN, rekOverzicht, REK_WARM, REK_HEET, RESERVES, reserveZin, leesQr, geenAntwoordZin, proefAdres, lnaOpties, kiesTelefoon, maakSseLezer, zonderDenken,
  };
}));
