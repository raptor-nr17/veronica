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
  // 483: VOL LOKAAL. De ENE regel of Veronica iets naar buiten mag sturen. Aan = alleen de eigen telefoons (een lokaal adres:
  // 127.x, 10.x, 192.168.x, 172.16-31.x, .local) en Veronica's eigen bestanden (zelfde origin). Alles anders (ntfy, GitHub, de
  // postbus, Google) niet. Uit = alles zoals altijd.
  const LOKAAL_HOST_RE = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|localhost|[a-z0-9-]+\.local)$/i;
  function magNaarBuiten(url, o) {
    const opt = o || {};
    if (!opt.volLokaal) return true;
    let u;
    try { u = new URL(String(url), opt.basis || undefined); } catch (e) { return false; }
    if (opt.basis) { try { if (u.origin === new URL(opt.basis).origin) return true; } catch (e) { /* geen basis */ } }
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOKAAL_HOST_RE.test(u.hostname);
  }
  const leesVolLokaal = (x) => x === '1';

  // 485: het samenwerken op trede 1 uit stand.json van de baas: de trede, de open voorstellen van de AI-kern (alleen tekst), het
  // aantal in het kennisboek. Wat niet klopt valt weg.
  // 494: NIEUWE TELEFOONS DIE MEE WILLEN DOEN (Bluetooth). De baas zet de wachtende vragen in stand.json: alleen een id, een naam
  // (merk/model) en het getal van vier cijfers dat ook op de nieuwe telefoon staat. Al het andere valt weg; hoogstens vijf.
  function leesNieuwKoppel(x) {
    if (!Array.isArray(x)) return [];
    return x.filter((w) => w && /^[A-Za-z0-9_-]{1,64}$/.test(String(w.id || '')) && /^\d{4}$/.test(String(w.getal || '')))
      .slice(0, 5).map((w) => ({ id: String(w.id), getal: String(w.getal),
        wie: String(w.wie || 'Een nieuwe telefoon').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 60) }));
  }
  function leesSamenwerken(x) {
    if (!x || typeof x !== 'object') return null;
    const tekst = (v, m) => String(v === null || v === undefined ? '' : v).slice(0, m);
    const voorstellen = (Array.isArray(x.voorstellen) ? x.voorstellen : []).slice(0, 20)
      .filter((v) => v && /^v\d{1,6}$/.test(String(v.id || '')))
      .map((v) => ({ id: v.id, klant: tekst(v.klant, 40), titel: tekst(v.titel, 120), tekst: tekst(v.tekst, 600), t: Number(v.t) || 0 }));
    const n = Number(x.kennisboek);
    return { trede: x.trede === 1 || x.trede === 2 || x.trede === 3 ? x.trede : 1, voorstellen, kennisboek: Number.isInteger(n) && n >= 0 ? n : null };
  }
  const TREDE_ZIN = {
    1: 'Trede 1: de telefoons doen voorstellen, jij keurt. Er wordt niets vanzelf uitgevoerd.',
    2: 'Trede 2: kleine veilige klussen die jij per soort hebt vrijgegeven.',
    3: 'Trede 3: meer vrijheid per soort klus, binnen de grenzen die jij zette.',
  };

  // 483: de nalees-lijst uit stand.json van de baas. Alleen tekst; wat niet klopt valt weg. null = de baas is niet aan de postbus gekoppeld.
  function leesNalees(n) {
    if (!n || typeof n !== 'object' || !Array.isArray(n.lijst)) return null;
    const tekst = (x, m) => String(x === null || x === undefined ? '' : x).slice(0, m);
    const lijst = [];
    for (const x of n.lijst.slice(0, 20)) {
      if (!x || !/^[a-z0-9-]{1,120}$/.test(String(x.taakId || '')) || !['vertaal', 'keuring', 'bord', 'buurtpin'].includes(x.soort)) continue;
      lijst.push({ taakId: x.taakId, soort: x.soort, taal: x.taal === 'en' || x.taal === 'de' ? x.taal : null, naam: tekst(x.naam, 120),
        bron: tekst(x.bron, 3000), concept: tekst(x.concept, 6000), telefoon: tekst(x.telefoon, 60),
        duurMs: typeof x.duurMs === 'number' && Number.isFinite(x.duurMs) && x.duurMs >= 0 ? Math.round(x.duurMs) : null,   // 515
        model: tekst(x.model, 60),
        meldingen: Array.isArray(x.meldingen) ? x.meldingen.slice(0, 6).map((m) => tekst(m, 200)) : [] });
    }
    return { lijst, t: Number(n.t) || 0, verstuurd: Math.max(0, Math.min(999, Number(n.verstuurd) || 0)) };
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
  // 481 (stap A): geheugen en Android-versie op de tegel, uit wat de telefoon zelf meldt. Het geheugen zoals op de doos (8 GB, niet
  // 7,4: dezelfde afronding als pool.js nominaalGb). Niets gemeld = null (dan geen regel: een springende tegel breekt het scrollen).
  const ANDROID_VAN_SDK = { 26: '8', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16', 37: '17' };
  function toestelZin(cap) {
    const c = cap || {};
    const delen = [];
    if (typeof c.ramGb === 'number' && c.ramGb > 0) {
      const doos = [2, 3, 4, 6, 8, 12, 16, 24, 32].find((g) => c.ramGb <= g * 0.97 + 0.4) || Math.round(c.ramGb);
      delen.push(`${doos} GB geheugen`);
    }
    if (typeof c.sdk === 'number' && c.sdk > 0) delen.push(ANDROID_VAN_SDK[c.sdk] ? `Android ${ANDROID_VAN_SDK[c.sdk]}` : `Android (API ${c.sdk})`);
    return delen.length ? delen.join(' · ') : null;
  }
  // 456b: dubbele Gemma-apps of modelkopieen op een telefoon. Alleen bekende namen, getallen en ja/nee, en een zin die als TEKST wordt getoond.
  const GEMMA_APPS = ['OlliteRT', 'OlliteRT (dev)', 'OlliteRT (beta)', 'Google AI Edge Gallery'];
  const OLLITE_TOESTANDEN = ['klaar', 'geen-model', 'staat-niet-aan', 'niet-geinstalleerd', 'onbekend', 'niet-nodig'];   // 557: niet-nodig = eigen motor
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
      // 481 (stap D): het geheugenmodel (EmbeddingGemma) op deze telefoon: alleen ja/nee en een zin.
      geheugen: m.geheugen && typeof m.geheugen === 'object' ? { klaar: m.geheugen.klaar === true, zin: typeof m.geheugen.zin === 'string' ? m.geheugen.zin.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160) : '' } : null,
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
  // 490: DE OVERZICHTSREGEL bovenaan elke tegel, zodat de eigenaar zonder foto's ziet hoe het staat: versie, motor aan/uit, hoe ver
  // het model is, en bezig of rustig. Alleen uit wat de telefoon zelf vers meldde; wat niet bekend is heet "onbekend", nooit een gok.
  function overzicht(o) {
    const x = o || {};
    if (x.bereikbaar === false) return { delen: ['geen antwoord'], tekst: 'Geen antwoord van deze telefoon.' };
    const delen = [];
    if (typeof x.versie === 'string' && x.versie) delen.push(`JARVIS ${x.versie}${x.nieuwste && vergelijkVersie(x.versie, x.nieuwste) < 0 ? ' (oud)' : ''}`);
    else delen.push('versie onbekend');
    const m = x.motor;
    if (!m) delen.push('motor onbekend');
    else if (!m.aan) delen.push('motor uit');
    else if (m.fase === 'te-oud') delen.push('motor: telefoon te oud');
    else if (m.fase === 'downloaden') delen.push(`motor aan, model ${m.procent}%`);
    else if (m.fase === 'laden') delen.push('motor aan, model laden');
    else if (m.klaar) delen.push('motor aan, model klaar');
    else if (m.fase === 'fout') delen.push('motor aan, fout');
    else delen.push(`motor aan, ${m.fase === 'wacht' ? 'wacht op wifi en lader' : m.fase === 'zoeken' ? 'model zoeken' : m.fase === 'gepauzeerd' ? 'gepauzeerd' : m.fase}`);
    // 495: de dagelijkse telefoon zegt het meteen: hij rust, of hij doet alleen nu mee (aan de lader, scherm uit).
    if (x.dagelijks === 'rust') delen.push('dagelijkse telefoon, rust');
    else delen.push(`${x.dagelijks === 'meedoen' ? 'dagelijkse telefoon, aan de lader · ' : ''}${x.bezig === true ? 'bezig' : x.bezig === false ? 'rustig' : 'bezig onbekend'}`);
    return { delen, tekst: delen.join(' · ') };
  }
  // 468: KLAAR VOOR DE EIGEN MOTOR? Een regel per telefoon die zegt wat al goed is en wat er nog moet gebeuren, uit
  // getallen die Veronica al heeft (RAM, Android, 64-bits, vrije ruimte, aan de lader). Niets wordt gestart: de knop
  // blijft bij de eigenaar. Grenzen: dezelfde als pool.js (4 GB RAM nominaal, 3 GB vrij) en motorkeuze.js (Android 10 = SDK 29).
  const MOTOR_MIN_SDK = 29;
  // 507: gelijk aan JarvisMotorKern (MIN_RAM_KLEIN_MB 3000, MIN_RAM_MB 5200). Een telefoon van 4 GB meldt ~3,5 GB: dat is de lichte
  // motor (een klein model, ~0,3-0,8 GB), niet "kan niet". Een telefoon van 3 GB meldt ~2,7 GB en kan niet.
  const MOTOR_MIN_RAM_GB = 2.9;
  const MOTOR_GROOT_RAM_GB = 5.1;
  const MOTOR_MIN_VRIJ_GB = 3;
  const MOTOR_MIN_VRIJ_KLEIN_GB = 1;
  const MOTOR_MODEL_GB = { 'Gemma 4 E4B': 3.7, 'Gemma 4 E2B': 2.6 };
  const MOTOR_MODEL_KLEIN_GB = { 'een klein model (lichte motor)': 0.8 };
  function motorKlaarZin(cap, extra) {
    const c = cap || {};
    const x = extra || {};
    const g = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
    const k1 = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
    const nog = [];
    const goed = [];
    const onbekend = [];
    if (c.arm64 === false) nog.push('deze telefoon is geen 64-bits ARM (dan kan de motor er nooit op)');
    else if (c.arm64 === true) goed.push('64-bits'); else onbekend.push('64-bits');
    const sdk = g(c.sdk);
    if (sdk !== null && sdk < MOTOR_MIN_SDK) nog.push(`Android te oud (Android 10 of nieuwer nodig)`);
    else if (sdk !== null) goed.push('Android nieuw genoeg'); else onbekend.push('Android-versie');
    const ram = g(c.ramGb);
    if (ram !== null && ram < MOTOR_MIN_RAM_GB) nog.push(`${k1(ram)} GB geheugen (minimaal ${MOTOR_MIN_RAM_GB} nodig; dat is niet te veranderen)`);
    else if (ram !== null) goed.push(`${k1(ram)} GB geheugen${ram < MOTOR_GROOT_RAM_GB ? ' (de lichte motor, met een klein model)' : ''}`); else onbekend.push('geheugen');
    const klein = ram !== null && ram < MOTOR_GROOT_RAM_GB;
    const minVrij = klein ? MOTOR_MIN_VRIJ_KLEIN_GB : MOTOR_MIN_VRIJ_GB;
    const vrij = g(c.vrijGb);
    if (vrij !== null && vrij < minVrij && x.modelGeladen !== true) {
      const modellen = Object.entries(klein ? MOTOR_MODEL_KLEIN_GB : MOTOR_MODEL_GB).map(([n, gb]) => `${k1(gb)} GB voor ${n}`).join(', ');
      nog.push(`maak nog ${k1(Math.ceil((minVrij - vrij) * 10) / 10)} GB vrij (nu ${k1(vrij)} GB vrij; ${modellen}): verwijder apps, foto's of video's op die telefoon`);
    } else if (vrij !== null) goed.push(`${k1(vrij)} GB vrij`); else onbekend.push('vrije ruimte');
    if (x.laadt === false) nog.push('zet hem aan de lader (het model wordt alleen aan de lader en op wifi binnengehaald)');
    else if (x.laadt === true) goed.push('aan de lader');
    const vast = nog.some((z) => /nooit|niet te veranderen|te oud/.test(z));
    let kop;
    if (vast) kop = 'Eigen motor: kan niet op deze telefoon';
    else if (nog.length) kop = 'Eigen motor: nog niet klaar';
    else if (onbekend.length === 4) kop = 'Eigen motor: nog niets bekend over deze telefoon';
    else kop = 'Eigen motor: klaar om aan te zetten';
    const delen = [`${kop}.`];
    if (nog.length) delen.push(`Te doen: ${nog.join('; ')}.`);
    if (goed.length) delen.push(`Al goed: ${goed.join(', ')}.`);
    if (onbekend.length && onbekend.length < 4) delen.push(`Nog niet gemeld: ${onbekend.join(', ')}.`);
    // 519b: sinds 500 zet een rektelefoon zijn motor VANZELF aan (wifi en lader); "nooit vanzelf" was onwaar geworden.
    if (!vast) delen.push('Een rektelefoon zet de motor vanzelf aan en haalt het model op wifi en aan de lader; de knop hieronder doet het meteen.');
    return { kop, kan: !vast, klaar: !vast && !nog.length && onbekend.length < 4, tekst: delen.join(' ') };
  }
  // 484: kan de eigen motor op deze telefoon met EEN tik aan (Pantser aan, "alles koppelen")? Alleen als JARVIS er draait, de
  // motor nog niet aan staat of klaar is, de telefoon zijn getallen VERS meldde en motorKlaarZin "klaar" zegt (dus ook aan de
  // lader). Een telefoon die niet klaar is krijgt geen aanzetten: daar staat op de tegel wat er nog moet gebeuren.
  function motorKandidaat(t, status, extra, nu) {
    if (!t || !t.jarvis || !status) return false;
    const vers = (x) => x && typeof x.t === 'number' && nu - x.t <= MAX_LEEFTIJD_MS;
    if (vers(status.dagelijks) && status.dagelijks.waarde) return false;   // 495: de dagelijkse telefoon doet niet mee met 'alles koppelen'
    const mo = vers(status.motor) ? status.motor.waarde : null;
    if (mo && (mo.klaar === true || mo.aan === true)) return false;
    const cap = vers(status.capaciteit) ? status.capaciteit.waarde : null;
    if (!cap) return false;
    return motorKlaarZin(cap, extra || {}).klaar === true;
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
  // 492: de zelftest van de telefoon (zelftest.js staat byte-gelijk in JARVIS en Veronica).
  const ZT = () => (typeof Zelftest !== 'undefined' ? Zelftest : (typeof require === 'function' ? require('./zelftest.js') : null));
  const zelftestLees = (z) => { const m = ZT(); return m ? m.lees(z) : null; };
  // 508: wat de telefoon over zijn brievenbus meldt (JARVIS 1.9.48+): een vingerafdruk (8 hex), of hij een onderwerp heeft, en hoe de
  // laatste hartslag ging (een zin). Nooit het onderwerp zelf.
  function leesBrievenbus(b) {
    if (!b || typeof b !== 'object') return null;
    return { vinger: /^[0-9a-f]{8}$/.test(String(b.vinger || '')) ? String(b.vinger) : null, onderwerp: b.onderwerp === true,
      hartslag: typeof b.hartslag === 'string' ? b.hartslag.replace(/[<>]/g, '').slice(0, 80) : null, t: typeof b.t === 'number' && b.t > 0 ? b.t : null };
  }
  // 508: waarom er geen hartslag komt, terwijl JARVIS wel over het wifi antwoordt. mijnVinger = die van Veronica's eigen onderwerp.
  function brievenbusUitleg(b, mijnVinger) {
    if (!b) return null;
    if (!b.onderwerp) return 'Deze telefoon kent het onderwerp van de brievenbus nog niet; Veronica geeft het hem.';
    if (mijnVinger && b.vinger && b.vinger !== mijnVinger) return 'Deze telefoon gebruikt een andere brievenbus dan Veronica; Veronica geeft hem de hare.';
    if (b.hartslag && /niet weg|kon niet/.test(b.hartslag)) return `De telefoon zegt: ${b.hartslag}`;
    return null;
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
      gespaard: meting(typeof x.gespaard === 'boolean' ? x.gespaard : null, bron, t),   // 481: de schuif Sparen op de telefoon
      kast: meting(leesKast(x.kast), bron, t),   // 498: wat de telefoon van de kast vraagt of aanbiedt
      zandbak: meting(typeof x.zandbak === 'boolean' ? x.zandbak : null, bron, t),   // 496: de zandbak voor veilig browsen (alleen ja/nee)
      dagelijks: meting(x.dagelijks === 'rust' || x.dagelijks === 'meedoen' ? x.dagelijks : null, bron, t),   // 495: de dagelijkse telefoon (rust, of doet nu mee)
      capaciteit: meting(leesCapaciteit(x.capaciteit), bron, t),
      gemma: meting(leesGemma(x.gemma), bron, t),
      rol: meting(x.rol === 'baas' || x.rol === 'werker' ? x.rol : null, bron, t),
      aikern: meting(leesAikern(x.aikern), bron, t),
      motor: meting(leesMotor(x.motor), bron, t),
      adressen: meting(Array.isArray(x.adressen) ? x.adressen.map((a) => normaalAdres(a, OLLITERT_POORT)).filter(Boolean).slice(0, 4) : null, bron, t),
      priveSleutel: meting(x.prive && typeof x.prive === 'object' && typeof x.prive.sleutel === 'boolean' ? x.prive.sleutel : null, bron, t),   // 466: ALLEEN ja/nee, nooit inhoud
      versie: meting(typeof x.versie === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(x.versie) ? x.versie : null, bron, t),
      bijwerkFout: meting(x.bijwerkFout === 'verlopen' ? 'verlopen' : null, bron, t),   // 487
      voorkeur: meting(x.voorkeur === 'kern' || x.voorkeur === 'rek' ? x.voorkeur : null, bron, t),   // 515: beheerder of werker (de keuze)
      bijwerkStap: meting(typeof x.bijwerkStap === 'string' && x.bijwerkStap.trim() ? x.bijwerkStap.replace(/[\u0000-\u001f]/g, ' ').slice(0, 220) : null, bron, t),   // 515: waarom hij (nog) niet bijwerkt
      zelftest: meting(zelftestLees(x.zelftest), bron, t),   // 492: alleen codes per punt (zelftest.js)
      brievenbus: meting(leesBrievenbus(x.brievenbus), bron, t),   // 508: vingerafdruk van het onderwerp en de laatste hartslag
      // 525: het vaste toestel-id (geen naam: die staat niet in de open stand), zodat een wens per id ook over het wifi aankomt
      toestel: meting(x.toestel && typeof x.toestel === 'object' && /^[A-Za-z0-9_-]{4,64}$/.test(String(x.toestel.id || '')) ? { id: String(x.toestel.id) } : null, bron, t),
    };
  }
  // 1.9.21 (452): WELKE JARVIS DRAAIT ER? Elke telefoon meldt zijn versie in /jarvis/status. Veronica zet hem bij de
  // telefoon en zegt in EEN zin of hij achterloopt, en dat het vanzelf gaat. De nieuwste versie is de hoogste die ze
  // ziet, of JARVIS_NIEUWSTE (de versie waarmee deze Veronica is gemaakt) -- nooit een versie die nergens genoemd wordt.
  const JARVIS_NIEUWSTE = '1.9.76';
  // 533: de rol in gewone woorden. Een rektelefoon met de rol 'baas' leidt de rij even (op het gastnetwerk zien de telefoons elkaar
  // niet); dat is geen beheerder. Zonder voorkeur in de hartslag (JARVIS van voor 1.9.64) herken je een rektelefoon aan zijn naam.
  // 546: gastbrein.js (in de browser een globale, in een test een require); zonder: alleen de code.
  function gastBreinModule() {
    if (typeof self !== 'undefined' && self.GastBrein) return self.GastBrein;
    try { return typeof require === 'function' ? require('./gastbrein.js') : null; } catch (e) { return null; }
  }
  function rolNaam(h) {
    const w = (x) => (x && typeof x === 'object' && 'waarde' in x ? x.waarde : x);   // ook een meting uit /jarvis/status
    if (h && h.gast && typeof h.gast === 'object') return 'gast-brein';   // 546: nooit baas, nooit rektelefoon
    if (!h || w(h.rol) !== 'baas') return 'werker';
    const voorkeur = w(h.voorkeur);
    if (voorkeur === 'kern') return 'beheerder';
    const rek = voorkeur === 'rek' || (!voorkeur && !w(h.dagelijks) && /^rektelefoon\s+\d+$/i.test(String(h.naam || '').trim()));
    return rek ? 'werker, leidt de rij even' : 'beheerder';
  }
  // 533: EEN TOESTEL = EEN REGEL in "Wie doet wat". Na een ander wifi staat dezelfde telefoon er met een oud EN een nieuw adres in
  // (hetzelfde vaste toestel-id); allebei hingen ze aan dezelfde hartslag en zo stond hij er dubbel. Blijft: de regel die bereikbaar
  // is, anders het adres dat zijn hartslag noemt, anders de laatste. Alleen voor de weergave; de opgeslagen lijst blijft zoals hij is.
  function ontdubbelTelefoons(lijst, bereikbaar, hartAdressen) {
    const host = (a) => { try { return new URL(a).hostname; } catch (e) { return ''; } };
    const uit = []; const per = new Map();
    for (const t of (Array.isArray(lijst) ? lijst : [])) {
      if (!t || !t.id) { uit.push(t); continue; }
      const i = per.get(t.id);
      if (i === undefined) { per.set(t.id, uit.length); uit.push(t); continue; }
      const oud = uit[i];
      const score = (x) => (bereikbaar(x) ? 2 : 0) + ((hartAdressen(x) || []).includes(host(x.adres)) ? 1 : 0);
      if (score(t) >= score(oud)) uit[i] = t;
    }
    return uit;
  }
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
    return { tekst: `JARVIS ${versie}: oud, wil bijwerken (loopt achter op ${nieuwste}). Hij werkt zichzelf vanzelf bij zodra hij aan de lader ligt en niets doet (hij kijkt elk uur, en Veronica vraagt het hem ook zelf; op sommige telefoons vraagt Android daarna een tik op Installeren).${wacht}`, achter: true };
  }
  // 515: REK VANZELF. Wat Veronica uit zichzelf naar EEN telefoon roept zodat hij meerekent, alleen uit een VERSE melding van die
  // telefoon zelf. Twee dingen, elk met een eigen rem per telefoon:
  //  - loopt hij achter, dan "kijk nu of er een nieuwe versie is" (roep 'roep' handmatig, 452) -- hoogstens eens per twee uur;
  //  - is hij een WERKER (geen beheerder, niet de dagelijkse telefoon, geen zandbak, niet gespaard) met de eigen motor UIT, dan
  //    "motor aan" -- hoogstens eens per twaalf uur. "Te oud" krijgt niets. Het model komt daarna vanzelf (wifi + lader, 460b).
  // Een beheerder wordt NOOIT vanzelf werker: dat is een knop (rekWerkerKnop), want de dagelijkse telefoon rust (495).
  const REK_KIJK_MS = 2 * 3600 * 1000;
  const REK_MOTOR_MS = 12 * 3600 * 1000;
  function rekBesluit(st, tijd, eerder, nieuwste) {
    const v = (k) => (st && st[k] && typeof st[k].t === 'number' && tijd - st[k].t <= MAX_LEEFTIJD_MS ? st[k].waarde : null);
    const e = eerder || {};
    const uit = [];
    const versie = v('versie');
    if (versie && nieuwste && vergelijkVersie(versie, nieuwste) < 0 && tijd - (e.kijk || 0) >= REK_KIJK_MS) {
      uit.push({ wat: 'kijk', roep: { soort: 'roep', handmatig: true, van: 'veronica' } });
    }
    const m = v('motor');
    if (m && !m.aan && m.fase !== 'te-oud' && rekWerker(st, tijd) && tijd - (e.motor || 0) >= REK_MOTOR_MS) {
      uit.push({ wat: 'motor', roep: { soort: 'motor-aan', van: 'veronica' } });
    }
    return uit;
  }
  // 522: HETZELFDE BESLUIT UIT EEN HARTSLAG. Op het gastnetwerk komt /jarvis/status nooit binnen (alleen de hartslag via de
  // brievenbus), en dan kreeg een werker met de motor uit nooit zijn "motor aan" -- zo bleef een werker op 21 oktober stil. Alleen
  // motor-aan, alleen een verse hartslag van een werker die niet de dagelijkse telefoon is en niet spaart, en dezelfde rem.
  function rekBesluitHart(h, tijd, eerder) {
    const e = eerder || {};
    if (!h || !h.id || typeof h.t !== 'number' || tijd - h.t > HARTSLAG_VERS_MS) return [];
    const m = h.motor;
    if (h.rol !== 'werker' || h.pauze || h.dagelijks || h.sparen || !m || m.aan || m.teOud) return [];
    if (tijd - (e.motor || 0) < REK_MOTOR_MS) return [];
    return [{ wat: 'motor', roep: { soort: 'motor-aan', van: 'veronica' } }];
  }
  // 525: WAAROM KOMT ER GEEN HARTSLAG, terwijl de telefoon wel over het wifi antwoordt? Uit zijn eigen /jarvis/status: zijn rol,
  // de motor, en wat de brievenbus zegt. Alleen wat hij meldt (hoogstens vijf minuten oud); anders null.
  function wifiUitleg(st, mijnVinger, tijd) {
    const v = (k) => (st && st[k] && typeof st[k].t === 'number' && tijd - st[k].t <= 5 * 60000 ? st[k].waarde : null);
    if (!v('versie') && !v('rol')) return null;
    const delen = [`antwoordt wel over het wifi${v('versie') ? ` (JARVIS ${v('versie')})` : ''}`];
    if (v('voorkeur') === 'kern' || v('rol') === 'baas') delen.push(v('dagelijks') ? 'staat als beheerder en rust als dagelijkse telefoon' : 'staat als beheerder');
    else if (v('rol') === 'werker') delen.push('staat als werker');
    const m = v('motor');
    if (m) delen.push(m.klaar ? 'motor klaar' : m.aan ? `motor aan (${m.fase}${m.procent ? `, ${m.procent}%` : ''})` : 'motor uit');
    const b = brievenbusUitleg(v('brievenbus'), mijnVinger);
    if (b) delen.push(b.charAt(0).toLowerCase() + b.slice(1).replace(/\.$/, ''));
    return delen.join('; ');
  }
  // 525: EEN WENS "MAAK WERKER" BLIJFT STAAN TOT DE TELEFOON HET ZELF MELDT. Een klik ging tot nu toe EEN keer de brievenbus in;
  // las de telefoon die niet (geen of een andere brievenbus, of de rij-code niet), dan verdween hij stil -- zo bleef een rektelefoon op
  // 22 oktober beheerder. Nu onthoudt Veronica de wens (alleen na de klik met bevestiging; nooit vanzelf) en stuurt hem opnieuw:
  // over het wifi zodra de telefoon daar antwoordt (elke tien minuten), anders via de brievenbus (elk half uur, ntfy telt per
  // huis). Klaar = de telefoon meldt zelf werker, geen beheerder-voorkeur en niet de dagelijkse telefoon. Na een dag vervalt hij.
  const WERKER_WENS_MS = 24 * 3600 * 1000;
  const WERKER_WIFI_MS = 10 * 60 * 1000;
  const WERKER_BUS_MS = 30 * 60 * 1000;
  // melding: { rol, voorkeur, dagelijks } uit /jarvis/status (wifi) of een hartslag (die kent geen voorkeur). via: 'wifi' | 'bus'.
  function werkerWensStap(wens, melding, tijd, via) {
    if (!wens || typeof wens.t !== 'number') return 'geen';
    const m = melding || null;
    if (m && m.rol === 'werker' && m.voorkeur !== 'kern' && !m.dagelijks) return 'klaar';
    if (tijd - wens.t > WERKER_WENS_MS) return 'verlopen';
    const laatst = via === 'wifi' ? wens.wifi : wens.bus;
    return tijd - (Number(laatst) || 0) >= (via === 'wifi' ? WERKER_WIFI_MS : WERKER_BUS_MS) ? 'stuur' : 'wacht';
  }
  // 522: WIE REKENT NU. Een regel per telefoon, alleen uit verse hartslagen (wat er niet gemeld is, zeggen we niet).
  // 522d: een telefoon ZONDER verse hartslag (oud, of alleen bekend uit de ledenbrief of de postbus) staat eronder in `oud`, met
  // wanneer hij zich voor het laatst meldde en ALTIJD de knop Maak werker: wat hij nu is weten we niet, en een rektelefoon die als
  // dagelijkse telefoon rust stuurt juist geen hartslag meer. De knop vraagt Veronica eerst te bevestigen (nooit de dagelijkse telefoon).
  const OUD_LIJST_MS = 30 * 24 * 3600 * 1000;
  // 529: WANNEER EN LANGS WELKE WEG zag Veronica deze telefoon het laatst: de hartslag (via de relay of de brievenbus), het wifi
  // (zijn eigen status) en de postbus (zijn hart daar). Alleen wat er gemeten is; een weg zonder meting noemen we niet.
  function gezienZin(h, lijnen) {
    const delen = [];
    if (h && typeof h.t === 'number' && h.t > 0) delen.push(`hartslag ${klokZin(h.t).slice(0, 5)} (${h.relay ? 'relay' : 'brievenbus'})`);
    const l = lijnen || {};
    if (typeof l.wifi === 'number' && l.wifi > 0) delen.push(`wifi ${klokZin(l.wifi).slice(0, 5)}`);
    if (typeof l.postbus === 'number' && l.postbus > 0) delen.push(`postbus ${klokZin(l.postbus).slice(0, 5)}`);
    return delen.length ? `laatst gezien: ${delen.join(', ')}` : 'nog nergens gezien';
  }
  // 529: HOE VAAK LAG HIJ STIL? De waakhond van JARVIS (1.9.63) meldt zelf de laatste vijf keer dat zijn klok meer dan vijf minuten
  // niet tikte (meestal: Android liet hem slapen). Alleen het laatste etmaal; met de lader erbij, want dat is wat helpt.
  const duurZin = (min) => (min >= 90 ? `${Math.round(min / 60)} uur` : `${min} minuten`);
  // 529: WAAROM STOPTE JARVIS (Android 11+, de redencode van ApplicationExitInfo). Alleen het laatste etmaal, de laatste keer.
  const STOP_REDEN = { 0: 'onbekend', 1: 'stopte zelf', 2: 'door het systeem beëindigd', 3: 'te weinig geheugen', 4: 'vastgelopen', 5: 'vastgelopen',
    6: 'reageerde niet (ANR)', 7: 'kon niet starten', 8: 'een toestemming veranderde', 9: 'gebruikte te veel (accu of geheugen)', 10: 'gestopt door een mens',
    11: 'gestopt door een mens (Instellingen)', 12: 'een onderdeel waar hij van afhing stopte', 13: 'door het systeem gestopt (fabrikant)', 14: 'bevroren door het systeem',
    15: 'uitgezet of verborgen', 16: 'bijgewerkt' };
  function stopZin(h, tijd) {
    const g = (h && Array.isArray(h.stops) ? h.stops : []).filter((x) => x && typeof x.t === 'number' && typeof x.reden === 'number' && tijd - x.t <= 24 * 3600 * 1000 && x.reden !== 16);
    if (!g.length) return '';
    const l = g.reduce((a, b) => (b.t > a.t ? b : a));
    return `stopte het laatst om ${klokZin(l.t).slice(0, 5)}: ${STOP_REDEN[l.reden] || `reden ${l.reden}`}${g.length > 1 ? ` (${g.length} keer in een etmaal)` : ''}`;
  }
  // 529: HET MEETUUR (meetplan D) in een zin, uit de hartslag.
  const komma = (x) => String(x).replace('.', ',');
  function meetuurZin(h) {
    const m = h && h.meetuur;
    if (!m) return '';
    if (m.bezig) return `meetuur loopt (sinds ${klokZin(m.start).slice(0, 5)}, ${m.n || 0} ${m.n === 1 ? 'meting' : 'metingen'})`;
    const delen = [];
    if (m.tpsMid !== null && m.tpsMid !== undefined) delen.push(`tempo ${komma(m.tpsMid)} tokens per seconde (${komma(m.tpsMin)} tot ${komma(m.tpsMax)}; begin ${komma(m.tpsBegin)}, eind ${komma(m.tpsEind)})`);
    if (m.tempMax !== null && m.tempMax !== undefined) delen.push(`warmte ${komma(m.tempBegin)} tot ${komma(m.tempMax)} graden`);
    if (m.accuBegin !== null && m.accuBegin !== undefined) delen.push(`accu ${m.accuBegin} naar ${m.accuEind}%${m.laadt ? ` (lader: ${m.laadt})` : ''}`);
    return `meetuur ${klokZin(m.start).slice(0, 5)}, ${m.min} minuten, ${m.gelukt} van ${m.n} gelukt${delen.length ? `: ${delen.join(', ')}` : ''}${m.reden && m.reden !== 'klaar' ? `; gestopt: ${m.reden}` : ''}`;
  }
  // 529: HET MEETBOEK (meetplan B): elke stilte en elke stop die een telefoon in zijn hartslag meldt, een keer (op tijdstip), hoogstens
  // acht dagen. Een hartslag draagt er maar vijf; het boek onthoudt de hele week. Alleen getallen.
  const BOEK_MS = 8 * 24 * 3600 * 1000;
  function meetboekBij(boek, h, tijd) {
    const b = boek && typeof boek === 'object' && boek.per ? boek : { sinds: tijd, per: {} };
    if (!h || !h.id) return b;
    const p = b.per[h.id] || (b.per[h.id] = { naam: h.naam || 'Een telefoon', slaap: [], stops: [] });
    p.naam = h.naam || p.naam;
    const voeg = (lijst, nieuw, sleutel) => {
      for (const x of (Array.isArray(nieuw) ? nieuw : [])) if (x && typeof x.t === 'number' && !lijst.some((y) => y.t === x.t)) lijst.push(sleutel(x));
      return lijst.filter((x) => tijd - x.t <= BOEK_MS).sort((a, c) => a.t - c.t).slice(-200);
    };
    p.slaap = voeg(p.slaap, h.slaap, (x) => ({ t: x.t, min: x.min, laadt: x.laadt }));
    p.stops = voeg(p.stops, h.stops, (x) => ({ t: x.t, reden: x.reden }));
    if (h.meetuur && !h.meetuur.bezig) p.meetuur = h.meetuur;
    return b;
  }
  // EEN samenvatting van het meten (B en D), per telefoon.
  function meetSamenvatting(boek, tijd) {
    const per = boek && boek.per ? boek.per : {};
    const regels = [];
    let stil = 0, stops = 0;
    for (const [id, p] of Object.entries(per)) {
      const sl = (p.slaap || []).filter((x) => tijd - x.t <= 7 * 24 * 3600 * 1000);
      const st = (p.stops || []).filter((x) => tijd - x.t <= 7 * 24 * 3600 * 1000 && x.reden !== 16);
      if (!sl.length && !st.length && !p.meetuur) continue;
      stil += sl.length; stops += st.length;
      const delen = [];
      if (sl.length) {
        const som = sl.reduce((n, x) => n + (Number(x.min) || 0), 0);
        const zonder = sl.filter((x) => x.laadt === false).length;
        delen.push(`lag ${sl.length === 1 ? 'een keer' : `${sl.length} keer`} stil (samen ${duurZin(som)}${zonder ? `; ${zonder === sl.length ? 'steeds' : `${zonder} keer`} zonder lader` : ''})`);
      } else delen.push('lag niet stil');
      if (st.length) {
        const tel = {};
        for (const x of st) tel[x.reden] = (tel[x.reden] || 0) + 1;
        delen.push(`stopte ${st.length === 1 ? 'een keer' : `${st.length} keer`} (${Object.entries(tel).map(([r, n]) => `${STOP_REDEN[r] || `reden ${r}`}${n > 1 ? ` ${n} keer` : ''}`).join(', ')})`);
      }
      const mz = meetuurZin({ meetuur: p.meetuur });
      if (mz) delen.push(mz);
      regels.push({ id, naam: p.naam, zin: `${p.naam}: ${delen.join('; ')}` });
    }
    const sinds = boek && boek.sinds ? new Date(boek.sinds).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' }) : '';
    const kop = regels.length ? `Meten${sinds ? ` (sinds ${sinds})` : ''}: ${stil} keer stil gelegen, ${stops} keer gestopt` : '';
    return { kop, regels };
  }
  function slaapZin(h, tijd) {
    const g = (h && Array.isArray(h.slaap) ? h.slaap : []).filter((x) => x && typeof x.t === 'number' && typeof x.min === 'number' && tijd - x.t <= 24 * 3600 * 1000);
    if (!g.length) return '';
    const l = g[g.length - 1];
    const lader = (x) => (x.laadt === false ? ', niet aan de lader' : x.laadt === true ? ', aan de lader' : '');
    const steeds = g.length > 1 && g.every((x) => x.laadt === false) ? '; steeds zonder lader' : '';
    return `lag het laatste etmaal ${g.length === 1 ? 'een keer' : `${g.length} keer`} stil, het laatst om ${klokZin(l.t).slice(0, 5)} voor ${duurZin(l.min)}${lader(l)}${steeds}`;
  }
  // 527: WAAROM ZWIJGT HIJ? Zonder lader mag Android een app laten slapen (Doze), tenzij de batterij van JARVIS op Onbeperkt staat;
  // dan haalt hij ook geen roep op. Een rektelefoon zweeg zo op 22 oktober uren (80%, de lader buiten de zonuren uit). We zeggen
  // alleen wat de laatste hartslag meldde; batterijVrij kent pas JARVIS 1.9.62.
  function stilUitleg(h) {
    if (!h || h.laadt) return '';
    if (h.batterijVrij === true) return '. Hij hing niet aan de lader maar mag van Android doorwerken: kijk of hij nog aan staat (wifi, accu).';
    const hoe = 'zet zijn lader aan (Stekkers, handknop Aan) of zet op de telefoon de batterij van JARVIS op Onbeperkt';
    return h.batterijVrij === false
      ? `. Hij hing niet aan de lader en Android mag JARVIS dan laten slapen; dan haalt hij ook geen roep op. Wat helpt: ${hoe}.`
      : `. Hij hing niet aan de lader; dan kan Android JARVIS laten slapen en haalt hij geen roep op. Wat helpt: ${hoe}.`;
  }
  // 537: het tempo van een telefoon uit zijn hartslag. ECHT werk (de laatste gelukte vertaling) gaat voor (525), dan de proefzin, dan het
  // laatste antwoord van de motor. 0 = niet gemeten.
  function tpsVan(h) {
    const m = h && h.motor;
    const gl = h && h.gids && h.gids.laatst && h.gids.laatst.ok && Number(h.gids.laatst.tps) > 0 ? Number(h.gids.laatst.tps) : 0;
    return gl || (m && ((m.proef && m.proef.ok && Number(m.proef.tps)) || Number(m.tps))) || 0;
  }
  // 537: WIE DOET WAT, kort, bovenaan Live. Per telefoon: naam, rol, het tempo (tokens per seconde, alleen gemeten) en wat hij mag doen
  // volgens de takenverdeling. Mag hij niets, dan de eerste reden. tempo: { <naam>: tps }.
  function wieDoetWat(verdeling, tempo) {
    const getal = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
    return (Array.isArray(verdeling) ? verdeling : []).map((t) => {
      const regels = Array.isArray(t.regels) ? t.regels : [];
      const doet = regels.filter((r) => r.mag && r.soort !== 'bewaker').map((r) => r.naam);
      const tps = tempo && Number(tempo[t.naam]) > 0 ? Number(tempo[t.naam]) : 0;
      const rol = t.taak && t.taak.naam ? t.taak.naam : (t.rol === 'baas' ? 'beheerder' : t.rol === 'werker' ? 'werker' : 'onbekend');
      const eerste = regels.find((r) => !r.mag && r.soort !== 'bewaker');
      const wat = doet.length ? `doet: ${doet.join(', ')}` : `doet nu niets${eerste ? ` (${eerste.reden})` : ''}`;
      return { naam: t.naam, tps, doet, zin: `${t.naam} (${rol}) · ${tps ? `ongeveer ${getal(tps)} tokens per seconde` : 'tempo nog niet gemeten'} · ${wat}` };
    });
  }
  function wieRekent(harten, tijd, bekend, lijnen) {
    const lijn = (id) => (lijnen && id && lijnen[id]) || null;   // 529: { wifi, postbus } per toestel-id
    const regels = [];
    const oud = [];
    const gezien = new Set();
    for (const h of (Array.isArray(harten) ? harten : [])) {
      if (!h || typeof h.t !== 'number') continue;
      if (tijd - h.t > HARTSLAG_VERS_MS) {
        if (h.id && tijd - h.t <= OUD_LIJST_MS && !gezien.has(h.id)) {
          gezien.add(h.id);
          // 557: antwoordde hij net RECHTSTREEKS over het wifi, dan leeft hij: dat zeggen we eerst, de oude hartslag daarna.
          const wifiVers = lijn(h.id) && typeof lijn(h.id).wifi === 'number' && tijd - lijn(h.id).wifi < 10 * 60 * 1000;
          oud.push({ id: h.id, naam: h.naam || 'Een telefoon', levend: wifiVers, zin: `${wifiVers ? `antwoordt rechtstreeks over het wifi (${klokZin(lijn(h.id).wifi).slice(0, 5)}); alleen zijn hartslag is oud: ` : ''}geen verse hartslag (laatste ${klokZin(h.t)}${tijd - h.t > 20 * 3600 * 1000 ? `, ${Math.round((tijd - h.t) / 3600000)} uur geleden` : ''}${h.rol ? `, toen ${rolNaam(h)}` : ''}${typeof h.accu === 'number' ? `, accu ${h.accu}%${h.laadt ? ', aan de lader' : ', niet aan de lader'}` : ''})${stilUitleg(h)}`, magWerker: true,
            gezien: gezienZin(h, lijn(h.id)), slaap: slaapZin(h, tijd), stop: stopZin(h, tijd), werk: typeof h.werk === 'string' ? h.werk.trim() : '' });
        }
        continue;
      }
      if (h.id) gezien.add(h.id);
      const m = h.motor;
      const naam = h.naam || 'Een telefoon';
      // 525: het tempo van ECHT werk (de laatste gelukte vertaling) gaat voor; m.tps is het laatste antwoord van de motor, en na een
      // kort antwoord (een ja/nee-controle, de proefzin) is dat laag omdat het inlezen van de vraag dan zwaar weegt (0,9 tegen 3,5).
      const gl = h.gids && h.gids.laatst && h.gids.laatst.ok && Number(h.gids.laatst.tps) > 0 ? Number(h.gids.laatst.tps) : 0;
      const tps = tpsVan(h);
      let zin; let rekent = false;
      // 522: JARVIS staat uit (de Uit-knop = ook de noodstop van de AI-kern). Dan start er niets, ook geen motor.
      const p = h.pauze && typeof h.pauze === 'object' ? h.pauze : null;
      if (p) zin = `JARVIS staat uit (noodstop${p.door && p.door !== 'onbekend' ? `, door ${p.door}` : ''}${p.t ? `, sinds ${klokZin(p.t)}` : ''}); er start niets`;
      else if (h.gast && typeof h.gast === 'object') {   // 546: het gast-brein, aan- of afwezig
        const G = gastBreinModule();
        rekent = h.gast.mag === true;
        zin = rekent ? `aanwezig, rekent mee aan het zware werk${m && m.model ? ` (${m.model})` : ''}` : `afwezig: ${(G && G.ZINNEN[h.gast.reden]) || 'onbekend'}`;
      } else if (h.dagelijks) zin = 'rust (dagelijkse telefoon)';
      else if (h.sparen) zin = 'spaart (de schuif Sparen staat aan)';
      else if (!m) zin = 'meldt geen eigen motor (oude JARVIS?)';
      else if (m.teOud) zin = 'te oud voor een eigen motor';
      else if (m.klaar) { rekent = true; zin = `rekent mee${m.model ? ` met ${m.model}` : ''}${tps ? `, ongeveer ${String(tps).replace('.', ',')} tokens per seconde${gl ? ' (bij het laatste verhaal)' : ''}` : ''}`; }
      else if (!m.aan) zin = h.rol === 'werker' ? 'motor staat uit; ik zet hem aan' : 'motor staat uit (beheerder)';
      else if (m.fase === 'downloaden') zin = `haalt het model binnen (${Number(m.procent) || 0}%)`;
      else if (m.fase === 'laden') zin = 'laadt het model';
      else if (m.fase === 'fout') zin = 'motor liep vast; ik zet hem opnieuw aan';
      // 543: het model komt alleen binnen op wifi EN aan de lader. Zeg wat er ontbreekt (de hartslag weet of hij laadt).
      else if (m.fase === 'wacht') zin = h.laadt === true ? 'motor aan, wacht op wifi zonder datalimiet om het model te halen' : h.laadt === false ? 'motor aan, wacht op de lader om het model te halen (alleen op wifi en aan de lader)' : 'motor aan, wacht op wifi en de lader om het model te halen';
      else zin = `motor aan (${m.fase || 'onbekend'})`;
      // 522: de laatste zin van de werker van de gids op die telefoon (waarom hij wel of niet werkt), als hij er een meldt.
      if (typeof h.werk === 'string' && h.werk.trim()) zin += `. Werker: ${h.werk.trim().replace(/\.$/, '')}`;
      // 522c: een beheerder die als dagelijkse telefoon RUST kan per ongeluk een rektelefoon zijn (de QR van Veronica gescand).
      // 539: ook een gekozen beheerder (voorkeur kern) kan met een klik en een bevestiging rektelefoon worden.
      regels.push({ id: h.id || naam, naam, zin, rekent, tps, pauze: !!p, magWerker: (h.voorkeur === 'kern' || (h.rol === 'baas' && h.dagelijks === true)) && !p && !h.gast, rol: rolNaam(h), gast: !!h.gast,
        gezien: gezienZin(h, lijn(h.id)), slaap: slaapZin(h, tijd), stop: stopZin(h, tijd), meet: meetuurZin(h), meetbaar: h.rol === 'werker' && !h.dagelijks && !p && !!(m && m.klaar) });   // 529
    }
    for (const b of (Array.isArray(bekend) ? bekend : [])) {
      if (!b || !b.id || gezien.has(b.id)) continue;
      gezien.add(b.id);
      oud.push({ id: b.id, naam: b.naam || 'Een telefoon', zin: 'nog geen hartslag ontvangen', magWerker: true, gezien: gezienZin(null, lijn(b.id)), slaap: '', werk: '' });
    }
    const n = regels.filter((r) => r.rekent).length;
    return { kop: regels.length ? `Wie rekent nu: ${n} van ${regels.length} ${regels.length === 1 ? 'telefoon' : 'telefoons'}` : 'Wie rekent nu: nog geen hartslag binnen', regels, oud };
  }
  function rekWerker(st, tijd) {
    const v = (k) => (st && st[k] && typeof st[k].t === 'number' && tijd - st[k].t <= MAX_LEEFTIJD_MS ? st[k].waarde : null);
    return v('rol') === 'werker' && v('voorkeur') !== 'kern' && !v('dagelijks') && v('zandbak') !== true && v('gespaard') !== true;
  }
  // De knop "Laat meerekenen": alleen bij een telefoon die zelf zegt dat hij beheerder is EN als dagelijkse telefoon rust.
  function rekWerkerKnop(st, tijd) {
    const v = (k) => (st && st[k] && typeof st[k].t === 'number' && tijd - st[k].t <= MAX_LEEFTIJD_MS ? st[k].waarde : null);
    return v('voorkeur') === 'kern' && v('dagelijks') === 'rust';
  }
  // Wie deed welk proefverhaal, en hoe snel: uit de concepten (nalees) en het tempo van de motor per telefoon. Alleen wat er staat.
  function proefPerTelefoon(nalees, tempo) {
    const per = {};
    for (const x of (nalees && Array.isArray(nalees.lijst) ? nalees.lijst : [])) {
      const n = x.telefoon || 'onbekend';
      const p = per[n] || (per[n] = { naam: n, aantal: 0, duur: [] });
      p.aantal += 1;
      if (typeof x.duurMs === 'number' && x.duurMs > 0) p.duur.push(x.duurMs);
    }
    return Object.values(per).sort((a, b) => b.aantal - a.aantal || (a.naam < b.naam ? -1 : 1)).map((p) => {
      const gem = p.duur.length ? Math.round(p.duur.reduce((a, b) => a + b, 0) / p.duur.length / 1000) : null;
      const tps = tempo && typeof tempo[p.naam] === 'number' && tempo[p.naam] > 0 ? tempo[p.naam] : null;
      return { naam: p.naam, aantal: p.aantal, gemS: gem,
        zin: `${p.naam}: ${p.aantal} ${p.aantal === 1 ? 'verhaal' : 'verhalen'}${gem !== null ? `, gemiddeld ${gem} s per verhaal` : ''}${tps !== null ? `, motor ±${String(tps).replace('.', ',')} tokens/s` : ''}` };
    }).concat(Object.keys(tempo || {}).filter((n) => !per[n] && typeof tempo[n] === 'number' && tempo[n] > 0).sort().map((n) => ({
      // 522d: een telefoon met een gemeten tempo maar nog geen verhaal: dan staat in elk geval zijn tempo er (en hoe lang een verhaal
      // van ongeveer 350 tokens dan ongeveer duurt).
      naam: n, aantal: 0, gemS: null,
      zin: `${n}: nog geen verhaal, motor ±${String(tempo[n]).replace('.', ',')} tokens/s (een verhaal van ±350 tokens duurt dan ±${Math.max(1, Math.round(350 / tempo[n] / 60))} min)` })));
  }
  // 524: DE KORTE SAMENVATTING VAN HET GIDSWERK, uit de hartslagen (dus ook op het gastnetwerk, waar de lijst met concepten niet
  // te lezen is). Per telefoon de nieuwste hartslag (tot 30 dagen oud): hoeveel concepten klaar, hoeveel de eigen controle
  // afkeurde, en het laatste stuk werk met duur en tempo. Alleen wat de telefoons melden; een oude JARVIS zonder blok telt niet mee.
  const SOORT_NAAM = { vertaal: 'vertaling', keuring: 'tekstkeuring', bord: 'bordfoto', buurtpin: 'buurtpin' };
  // 535: HET GEZONDHEIDSRAPPORT VAN DE TELEFOONS (hartslag.js leesGezond), in EEN regel op Live. Alleen rapporten van de laatste 24 uur;
  // zonder open problemen staat er niets (geen ruis). Wat er staat komt letterlijk van de telefoon, ingekort.
  const GEZOND_VERS_MS = 24 * 3600 * 1000;
  function gezondSamenvatting(rapporten, tijd) {
    const vers = (Array.isArray(rapporten) ? rapporten : []).filter((r) => r && r.t && tijd - r.t <= GEZOND_VERS_MS && Array.isArray(r.open) && r.open.length)
      .sort((a, b) => b.t - a.t);
    if (!vers.length) return { kop: '', regels: [] };
    const n = vers.reduce((x, r) => x + r.open.length, 0);
    const regels = vers.map((r) => ({ naam: r.naam || 'een telefoon', zin: `${r.naam || 'Een telefoon'} (${r.versie ? `JARVIS ${r.versie}, ` : ''}${klokZin(r.t).slice(0, 5)}): ${r.open.map((m) => m.zin).join(' ')}` }));
    return { kop: `Gezondheid: ${n} ${n === 1 ? 'probleem' : 'problemen'} dat JARVIS niet zelf kan oplossen, op ${vers.length} ${vers.length === 1 ? 'telefoon' : 'telefoons'}`, regels };
  }
  function gidsSamenvatting(harten, tijd) {
    const per = {};
    for (const h of (Array.isArray(harten) ? harten : [])) {
      if (!h || typeof h.t !== 'number' || tijd - h.t > OUD_LIJST_MS || !h.gids || typeof h.gids !== 'object') continue;
      const k = h.id || h.naam || '?';
      if (!per[k] || per[k].t < h.t) per[k] = h;
    }
    const lijst = Object.values(per).sort((a, b) => ((a.naam || '') < (b.naam || '') ? -1 : 1));
    const klaar = lijst.reduce((n, h) => n + (Number(h.gids.klaar) || 0), 0);
    const afgekeurd = lijst.reduce((n, h) => n + (Number(h.gids.afgekeurd) || 0), 0);
    const tempo = {};
    const regels = lijst.filter((h) => h.gids.klaar || h.gids.afgekeurd || h.gids.laatst).map((h) => {
      const g = h.gids; const l = g.laatst;
      const naam = h.naam || 'Een telefoon';
      if (l && l.ok && l.tps > 0) tempo[naam] = l.tps;
      let zin = `${naam}: ${g.klaar || 0} klaar${g.afgekeurd ? `, ${g.afgekeurd} afgekeurd door de eigen controle` : ''}`;
      if (l) {
        const wat = `${SOORT_NAAM[l.soort] || 'werk'}${l.taal ? ` (${l.taal})` : ''}`;
        const duur = l.ms > 0 ? (l.ms >= 90000 ? `${Math.round(l.ms / 60000)} min` : `${Math.round(l.ms / 1000)} s`) : '';
        zin += l.ok
          ? `; laatste: ${wat}${duur ? ` in ${duur}` : ''}${l.tps > 0 ? `, ±${String(l.tps).replace('.', ',')} tokens/s` : ''} (${klokZin(l.t)})`
          : `; laatste ${wat} afgekeurd${l.reden ? `: ${l.reden}` : ''} (${klokZin(l.t)})`;
      }
      return { id: h.id || naam, naam, zin, klaar: g.klaar || 0, afgekeurd: g.afgekeurd || 0 };
    });
    // 527: `klaar` is een TELLER van de telefoon (alles wat hij ooit teruglegde), niet wat er nu wacht: gekeurde en weggezette
    // concepten tellen mee. Wat nu op een oordeel wacht staat alleen bij Nalezen; zeg dus niet "klaar om na te lezen".
    const kop = !regels.length ? '' : `Gids-proef: ${klaar} ${klaar === 1 ? 'concept' : 'concepten'} gemaakt (alles samen, ook wat al gekeurd of weggezet is; wat nu wacht staat bij Nalezen)${afgekeurd ? `, ${afgekeurd} afgekeurd door de eigen controle (die worden geen concept)` : ''}`;
    return { kop, regels, tempo, klaar, afgekeurd };
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
        // 539: het vaste toestel-id (JARVIS zet het sinds 482 als `toestel` in de lijst). Daarmee vindt Veronica de hartslag
        // van deze telefoon ook als het adres in de lijst oud is (een andere router, een ander wifi).
        id: /^[a-z0-9]{12,32}$/.test(String(ruw.toestel || ruw.id || '')) ? String(ruw.toestel || ruw.id) : '',
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
    return { telefoons: uit, stekkers, stekkersGevonden, stekkerScan, priveBezig, rol: x.rol === 'baas' || x.rol === 'werker' ? x.rol : null, kern: normaalAdres(x.kern, JARVIS_POORT), code: /^\d{6}$/.test(String(x.code || '')) ? String(x.code) : null, bekend: leesLeden(x.leden), ledenIds: leesLedenIds(x.leden), ntfy: leesNtfy(x.ntfy), eigenaar: leesEigenaar(x.eigenaar), updateSleutel: leesUpdateSleutel(x.updateSleutel), updateRepo: typeof x.updateRepo === 'string' && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(x.updateRepo) && !x.updateRepo.includes('..') ? x.updateRepo : null, nieuweTelefoon: leesNieuweTelefoon(x.nieuweTelefoon), postbusAdres: leesPostbusAdres(x.postbusAdres) };
  }
  // 1.9.14: de downloadlink voor een nieuwe telefoon (QR "JARVIS op een nieuwe telefoon zetten"). Alleen een
  // ondertekend adres in de postbus (zelfde regel als de werker in JARVIS); al het andere: null.
  const POSTBUS_HOST = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.s3\.[a-z]{2}-[a-z]{3}\.scw\.cloud$/;
  // 487: het postbus-adres van de baas (een ondertekend adres van het pakket, hoogstens zeven dagen geldig). Veronica bewaart het
  // NIET (alleen in het geheugen van de pagina) en geeft het alleen terug aan een eigen telefoon die vastzit: met een roep (een
  // tik) of als QR "LRWERK1 <adres>" (dezelfde als op de beheerpagina) voor een oude JARVIS.
  function leesPostbusAdres(a) {
    if (typeof a !== 'string' || a.length > 2000) return null;
    let u;
    try { u = new URL(a); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !POSTBUS_HOST.test(u.hostname)) return null;
    if (!/[/]gemma-werk[/]taken[/]pakket[.]json$/.test(u.pathname) || !u.searchParams.get('X-Amz-Signature')) return null;
    return u.href;
  }
  function adresGetekend(a) {
    let d = null;
    try { d = new URL(a).searchParams.get('X-Amz-Date'); } catch (e) { return 0; }
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(d || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
  }
  const postbusQrTekst = (a) => (leesPostbusAdres(a) ? `LRWERK1 ${leesPostbusAdres(a)}` : null);
  // 488: een adres is alleen iets waard als het nog geldt (zeven dagen na het ondertekenen, met tien minuten marge). Een verlopen
  // adres van de baas als QR tonen gaf op 17 oktober een QR die niets deed: dan liever eerlijk zeggen en om een verse code vragen.
  const ADRES_GELDIG_MS = 7 * 24 * 3600 * 1000 - 10 * 60 * 1000;
  const adresVers = (a, nu) => { const t = leesPostbusAdres(a) ? adresGetekend(a) : 0; return t > 0 && (nu || Date.now()) - t < ADRES_GELDIG_MS; };
  // 488: een geplakte koppelcode ("LRWERK1 <adres>", zoals in de mail of op de beheerpagina), ook met witruimte of een regeleinde.
  function leesPlakCode(tekst) {
    const t = String(tekst || '').replace(/\s+/g, ' ').trim().replace(/^LRWERK1 /, '');
    return leesPostbusAdres(t);
  }
  // 504: DE MAIL "JARVIS weer bijwerken" PLAKKEN. Gmail pakt elke link in (www.google.com/url?q=...): die halen we eraf. Er gaan
  // er twee uit: de downloadlink van jarvis.apk en de koppelcode (het adres van het pakket). Alles alleen in het geheugen.
  function leesApkAdres(a) {
    if (typeof a !== 'string' || a.length > 2000) return null;
    let u;
    try { u = new URL(a); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !POSTBUS_HOST.test(u.hostname)) return null;
    if (!/[/]gemma-werk[/]jarvis[/]jarvis[.]apk$/.test(u.pathname) || !u.searchParams.get('X-Amz-Signature')) return null;
    return u.href;
  }
  function pakUit(a) {
    let x = String(a || '').replace(/&amp;/g, '&');
    for (let i = 0; i < 2; i++) {
      let u;
      try { u = new URL(x); } catch (e) { return x; }
      if (!/(^|[.])google[.][a-z.]+$/.test(u.hostname) || u.pathname !== '/url') return x;
      const q = u.searchParams.get('q') || u.searchParams.get('url');
      if (!q) return x;
      x = q;
    }
    return x;
  }
  function leesMail(tekst) {
    const uit = { apk: null, code: null };
    const links = String(tekst || '').match(/https:[/][/][^\s<>"']+/g) || [];
    for (const l of links) {
      const a = pakUit(l);
      const apk = leesApkAdres(a); const code = leesPostbusAdres(a);
      if (apk && (!uit.apk || adresGetekend(apk) > adresGetekend(uit.apk))) uit.apk = apk;
      if (code && (!uit.code || adresGetekend(code) > adresGetekend(uit.code))) uit.code = code;
    }
    return uit;
  }
  // Tot wanneer een ondertekend adres geldt: ondertekend + X-Amz-Expires (hoogstens zeven dagen), met tien minuten marge.
  function geldigTot(a) {
    const t = adresGetekend(a);
    if (!t) return 0;
    let s = 0;
    try { s = Number(new URL(a).searchParams.get('X-Amz-Expires')) || 0; } catch (e) { return 0; }
    s = Math.min(Math.max(s, 0), 7 * 24 * 3600);
    return s ? t + s * 1000 - 10 * 60 * 1000 : 0;
  }
  const nogGeldig = (a, nu) => geldigTot(a) > (nu || Date.now());
  // "geldig tot zondag 19 oktober 22:32" in Nederlandse tijd.
  function totZin(ms) {
    if (!ms) return '';
    try {
      const d = new Date(ms);
      const dag = d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' });
      const uur = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
      return `${dag} ${uur}`;
    } catch (e) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
  }
  // Moet deze telefoon geholpen worden met een vers adres? Alleen als hij achterloopt EN (hij zegt zelf "verlopen", of hij is
  // ouder dan 1.9.39: die nemen een nieuwer adres van de baas niet vanzelf over).
  const VERS_ADRES_VANAF = '1.9.39';
  function bijwerkHulp(versie, nieuwste, fout) {
    if (typeof versie !== 'string' || vergelijkVersie(versie, nieuwste) >= 0) return null;
    const oud = vergelijkVersie(versie, VERS_ADRES_VANAF) < 0;
    if (fout !== 'verlopen' && !oud) return null;
    return { tik: !oud, qr: oud, zin: oud
      ? `Deze JARVIS (${versie}) kan zijn postbus-adres niet zelf vernieuwen. Een keer: tik op "Toon de QR", en scan hem op die telefoon met JARVIS (Scan). Daarna werkt hij zichzelf bij en is dit nooit meer nodig.`
      : 'Het postbus-adres van deze telefoon is verlopen. Tik op "Geef een vers adres"; daarna werkt hij zichzelf bij.' };
  }

  // 499: de VASTE link (https://<eigen domein>/jarvis-app/<tien tekens>) verloopt niet; die gaat voor in de QR. Geen query, geen poort.
  const VASTE_LINK_RE = /^https:\/\/[a-z0-9.-]{3,253}\/jarvis-app\/[a-z2-9]{10}$/;
  function leesNieuweTelefoon(n) {
    if (!n || typeof n !== 'object') return null;
    const vast = typeof n.vast === 'string' && VASTE_LINK_RE.test(n.vast) ? n.vast : null;
    let apk = null;
    if (typeof n.apk === 'string' && n.apk.length <= 2000) {
      let u = null;
      try { u = new URL(n.apk); } catch (e) { u = null; }
      if (u && u.protocol === 'https:' && !u.port && !u.username && !u.password && POSTBUS_HOST.test(u.hostname)) apk = u.href;
    }
    if (!apk && !vast) return null;
    const tot = apk && typeof n.tot === 'string' && !Number.isNaN(Date.parse(n.tot)) ? n.tot : null;
    return vast ? { apk, tot, vast } : { apk, tot };
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
  // 539: de leden van de baas met hun id en ALLE adressen die ze ooit hadden (de vindladder). Zo hoort een oud adres in de lijst
  // toch bij een toestel-id, en dus bij een hartslag.
  function leesLedenIds(leden) {
    const uit = [];
    for (const l of (Array.isArray(leden) ? leden : []).slice(0, 24)) {
      if (!l || !/^[a-z0-9]{12,32}$/.test(String(l.id || ''))) continue;
      const hosts = (Array.isArray(l.adressen) ? l.adressen : []).map((a) => String((a && a.host) || '')).filter((h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)).slice(0, 8);
      uit.push({ id: String(l.id), hosts });
    }
    return uit;
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
  // 498: DE UITDEELKAST -- alleen namen, groottes en een sha256; al het andere valt weg.
  const KAST_NAAM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  function leesKast(k) {
    if (!k || typeof k !== 'object') return null;
    const bytes = (b) => (Number.isFinite(b) && b > 0 && b <= 6e9 ? Math.floor(b) : 0);
    const naam = (n) => (typeof n === 'string' && KAST_NAAM_RE.test(n) && !n.includes('..') ? n : null);
    const model = (l) => (Array.isArray(l) ? l : []).slice(0, 2).filter((x) => x && x.soort === 'model' && naam(x.naam) && /^[0-9a-f]{64}$/i.test(String(x.sha256 || '')) && bytes(x.bytes))
      .map((x) => ({ soort: 'model', naam: x.naam, sha256: String(x.sha256).toLowerCase(), bytes: bytes(x.bytes) }));
    return {
      aanbod: (Array.isArray(k.aanbod) ? k.aanbod : []).slice(0, 20).filter((x) => x && naam(x.naam) && bytes(x.bytes)).map((x) => ({ naam: x.naam, bytes: bytes(x.bytes) })),
      vraag: model(k.vraag), heeft: model(k.heeft),
    };
  }
  // 495: LOKAAL EERST -- de prijs per miljoen tokens van een betaald model, alleen om te SCHATTEN wat lokaal werk scheelt.
  // De beheerder stelt hem zelf in (alleen in deze browser); er wordt nergens een extern model aangeroepen.
  const TOKENPRIJS_STANDAARD = 5;
  function leesTokenprijs(t) {
    const n = Number(String(t === undefined || t === null ? '' : t).trim().replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= 200 ? Math.round(n * 100) / 100 : TOKENPRIJS_STANDAARD;
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
  // 480: het net van de router van nu (192.168.178) VOORAAN: zonder eigen adres (Chromebook) is de volgorde een gok, en de eerste gok
  // hoort de router te zijn waar het huis sinds 16 oktober op zit.
  const GANGBARE_NETTEN = ['192.168.178', '192.168.1', '192.168.68', '192.168.0', '192.168.2', '10.0.0'];
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
  const VERONICA_VERSIE = '1.9.105';
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
  // ---- 476: ZELF HERSTELLEN NA EEN ANDER WIFI (16 oktober: het huis kreeg een andere router) ----
  // Veronica had de telefoons onthouden op het OUDE net en zei alleen "0 van 2 bereikbaar". Nu: antwoordt geen enkel
  // onthouden adres meer, dan zoekt ze de telefoons opnieuw op het netwerk -- eerst het wifi van deze computer, dan de
  // gangbare thuisnetten, en het oude net als laatste. Ze vraagt op elk adres /jarvis/vertrouwd MET de code: alleen een
  // eigen telefoon antwoordt daar met 200, dus een treffer is bewezen (geen gokwerk, niets te typen).
  function herstelPlan(o) {
    const x = o || {};
    const eigen = (x.eigen || []).map(String).filter(isThuisNet);
    const eigenNetten = [];
    for (const ip of eigen) { const n = netVan(ip); if (n && !eigenNetten.includes(n)) eigenNetten.push(n); }
    const oudeNetten = [];
    for (const a of x.bekend || []) { const n = netVan(a); if (n && isThuisNet(`${n}.1`) && !oudeNetten.includes(n)) oudeNetten.push(n); }
    const netten = eigenNetten
      .concat(GANGBARE_NETTEN.filter((n) => !eigenNetten.includes(n) && !oudeNetten.includes(n)))
      .concat(oudeNetten.filter((n) => !eigenNetten.includes(n)));
    const adressen = [];
    for (const n of netten) {
      const mijn = eigen.find((ip) => ip.startsWith(n + '.'));
      for (const a of subnetAdressen(mijn || `${n}.0`)) if (!adressen.includes(a)) adressen.push(a);
    }
    return { eigenNetten, oudeNetten, netten, adressen, gok: !eigenNetten.length };
  }
  // De zinnen erbij, in gewone taal. fase: 'zoekt' | 'gevonden' | 'niets'.
  function herstelZin(fase, o) {
    const x = o || {};
    const lijst = (ns) => (ns || []).map((n) => `${n}.x`).join(', ');
    if (fase === 'zoekt') {
      // 502: na een verhuizing zitten de telefoons op een ander wifi; dat zeggen, niet "geen antwoord op het oude adres".
      const oud = x.oudeNetten && x.oudeNetten.length ? ` Laatst bekend op ${lijst(x.oudeNetten)}.` : '';
      // 503: op een gastnetwerk zien toestellen elkaar NOOIT; dat is geen fout. De brievenbus is de hoofdweg.
      return `Geen directe wifi-verbinding met de telefoons.${oud} Op een gastnetwerk is dat normaal: alles gaat dan via de brievenbus. Ander wifi? Ik zoek ze intussen opnieuw op dit netwerk (${lijst(x.netten)}); hier hoef je niets te typen.`;
    }
    if (fase === 'gevonden') {
      const net = x.net ? ` (${x.net}.x)` : '';
      const namen = (x.namen || []).filter(Boolean);
      return `Gevonden op het nieuwe wifi${net}${namen.length ? `: ${namen.join(', ')}` : ''}. Ik kijk weer mee.`;
    }
    // 480: eerlijk zeggen WAT er te zien was. Antwoordde er wel een JARVIS maar kende hij de code niet, dan is het een andere rij
    // (of een telefoon die opnieuw gekoppeld is). Antwoordde er geen enkele: dan draait JARVIS nergens -- na een update staat
    // de app dicht tot iemand hem opent, en dat is de eerste plek om te kijken.
    if (x.jarvis > 0) return `Ik zag ${x.jarvis === 1 ? 'een JARVIS-telefoon' : `${x.jarvis} JARVIS-telefoons`} op het netwerk, maar ${x.jarvis === 1 ? 'die kent' : 'die kennen'} de code van deze rij niet. Scan op Koppelen de QR van Veronica met de baas-telefoon: dan horen ze weer bij elkaar.`;
    return `Ook op het netwerk niets gevonden (${x.aantal || 0} adressen geprobeerd, geen enkele JARVIS antwoordde). Net een update van JARVIS gehad? Dan staat de app dicht tot je hem een keer opent: tik op de telefoon op de melding "JARVIS is bijgewerkt", of open JARVIS. Zitten de telefoons op hetzelfde wifi als deze computer (niet op mobiele data of een gastnetwerk)? Over een paar minuten probeer ik het opnieuw. Sneller: open Koppelen en scan de QR daar met de baas-telefoon.`;
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
  // 513 (19 oktober): DE RIJBRIEF, de omgekeerde richting van de adresbrief. Een telefoon die de QR van Veronica scant krijgt
  // via de brievenbus HAAR brievenbus (het geheime ntfy-onderwerp) en de code van de rij, en of er al een baas is (dan wordt
  // hij werker in plaats van een eigen rij te beginnen). Zelfde sleutel uit de QR, een ANDER onderwerp ('vj') en een andere
  // sleutelafleiding dan de adresbrief. Vijf minuten bruikbaar, net als de QR. koppel.js (JARVIS) leest hem; een test vergelijkt.
  const RIJ_CODE_RE = /^\d{6}$/;
  async function rijBriefOnderwerp(s, c) {
    return 'vj' + naarHex(await cryptoNu(c).subtle.digest('SHA-256', tekstBytes('veronica-rij:' + s))).slice(0, 30);
  }
  async function rijBriefVerzoek(s, d, nuMs, c) {
    if (!TOKEN_RE.test(String(s || '')) || !d || !LEDEN_ONDERWERP_RE.test(String(d.onderwerp || ''))) return null;
    const inhoud = { o: d.onderwerp, t: Math.floor(Number(nuMs) || 0) };
    if (RIJ_CODE_RE.test(String(d.code || ''))) inhoud.c = String(d.code);
    if (d.werker === true) inhoud.w = 1;
    const naam = String(d.baasNaam || '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40);
    if (naam) inhoud.b = naam;
    const sub = cryptoNu(c).subtle;
    const iv = new Uint8Array(12);
    cryptoNu(c).getRandomValues(iv);
    const k = await sub.importKey('raw', await sub.digest('SHA-256', tekstBytes('veronica-rijsleutel:' + s)), { name: 'AES-GCM' }, false, ['encrypt']);
    const data = await sub.encrypt({ name: 'AES-GCM', iv }, k, tekstBytes(JSON.stringify(inhoud)));
    return { method: 'POST', url: BRIEF_SERVER, headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ topic: await rijBriefOnderwerp(s, c), message: JSON.stringify({ iv: naarHex(iv), data: naarHex(data) }) }) };
  }
  async function veronicaOpenMet(s, iv, data, voor, c) {
    const sub = cryptoNu(c).subtle;
    const raw = await sub.digest('SHA-256', tekstBytes(voor + s));
    const k = await sub.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    return new TextDecoder().decode(await sub.decrypt({ name: 'AES-GCM', iv: hexNaar(iv) }, k, hexNaar(data)));
  }

  // 482 (17 oktober): DE LEDENBRIEF van de baas (koppel.js, ledenBriefVerzoek): de leden MET hun adressen. Het onderwerp en
  // de sleutel komen uit het geheime ntfy-onderwerp van de rij (S.ntfy.onderwerp), niet uit de code van zes cijfers.
  const LEDEN_ONDERWERP_RE = /^jv[a-z0-9]{30}$/;
  const LEDEN_VERS_MS = 30 * 60 * 1000;   // zolang is een brief "vers": dan zoekt Veronica niets af, ze gebruikt de brief
  async function ledenOnderwerp(o, c) {
    if (!LEDEN_ONDERWERP_RE.test(String(o || ''))) return null;
    return 'vl' + naarHex(await cryptoNu(c).subtle.digest('SHA-256', tekstBytes('veronica-leden:' + o))).slice(0, 30);
  }
  // Een regel van ntfy -> { t, leden: [{ naam, id, host, poort, rol }] } (alleen thuisadressen), of null.
  async function leesLedenBrief(o, regel, c) {
    if (!LEDEN_ONDERWERP_RE.test(String(o || ''))) return null;
    let m, b, d;
    try { m = JSON.parse(regel); } catch (e) { return null; }
    if (!m || (m.event && m.event !== 'message')) return null;
    try { b = JSON.parse(m.message); d = JSON.parse(await veronicaOpenMet(o, b.iv, b.data, 'veronica-leden-sleutel:', c)); } catch (e) { return null; }
    if (!d || d.v !== 1 || !Array.isArray(d.leden)) return null;
    const leden = d.leden.filter((l) => l && isThuisNet(String(l.host || ''))).slice(0, 12).map((l) => ({
      naam: String(l.naam || '').slice(0, 40), id: String(l.id || '').slice(0, 40), host: String(l.host),
      poort: Number(l.poort) > 0 && Number(l.poort) < 65536 ? Number(l.poort) : JARVIS_POORT, rol: l.rol === 'baas' ? 'baas' : 'werker',
    }));
    return { t: Number(d.t) || 0, leden };
  }
  // De adressen uit een verse brief gaan VOOR in de rondvraag; de baas eerst.
  function metLedenBrief(lijst, brief, nuMs) {
    if (!ledenBriefVers(brief, nuMs)) return (lijst || []).slice();
    const uitBrief = brief.leden.slice().sort((a, b) => (b.rol === 'baas') - (a.rol === 'baas')).map((l) => `http://${l.host}:${l.poort}`);
    return uitBrief.concat((lijst || []).filter((a) => !uitBrief.includes(a)));
  }
  // 500: de adressen uit VERSE hartslagen (hoogstens twee uur oud) gaan nog voor de ledenbrief: elke telefoon meldt zijn eigen adres.
  const HARTSLAG_VERS_MS = 2 * 60 * 60 * 1000;
  // ---- 539: HET ADRES DAT DE TELEFOON ZELF DOORGEEFT WINT ----
  //
  // Na een wissel van wifi (24 oktober: een andere router, 192.168.178.x) bleef Veronica het oude adres en de oude poort proberen
  // (8000, van OlliteRT) die de baas in zijn lijst doorgaf, terwijl de telefoon in zijn hartslag zijn NIEUWE adressen, de poort van
  // JARVIS en "motor klaar" meldde. Regel: een verse hartslag wint van de lijst. Het adres van JARVIS wordt host + de poort uit de
  // hartslag; het rekenadres wordt de eigen motor (8081, met de rij-code als sleutel) zodra de hartslag "klaar" zegt, anders dezelfde
  // poort als voorheen op het nieuwe adres. Zonder thuisadres in de hartslag (alleen de brievenbus) verandert er niets aan het adres.
  const MOTOR_POORT = 8081;
  const hostVan = (a) => ((/^http:\/\/([^:/]+)/.exec(String(a || '')) || [])[1] || '');
  const poortVan = (a) => Number((/^http:\/\/[^:/]+:(\d+)/.exec(String(a || '')) || [])[1]) || 0;
  // Welke hartslag hoort bij deze telefoon: op id, dan op een adres dat hij nu meldt, dan via de ledenlijst van de baas (een oud adres).
  function hartVoorTelefoon(t, harten, ledenIds) {
    const lijst = Object.values(harten || {}).filter((h) => h && h.id && h.t);
    if (!t) return null;
    if (t.id) { const h = lijst.find((x) => x.id === t.id); if (h) return h; }
    const hosts = [hostVan(t.jarvis), hostVan(t.adres)].filter(Boolean);
    const opAdres = lijst.filter((h) => Array.isArray(h.adressen) && h.adressen.some((a) => hosts.includes(a))).sort((a, b) => b.t - a.t)[0];
    if (opAdres) return opAdres;
    for (const l of ledenIds || []) {
      if (l && l.id && Array.isArray(l.hosts) && l.hosts.some((x) => hosts.includes(x))) { const h = lijst.find((x) => x.id === l.id); if (h) return h; }
    }
    return null;
  }
  // Terug: { id, adres, jarvis, motor } (het nieuwe), { id } (alleen het id: de hartslag noemt geen thuisadres), of null.
  // o: { nu, code, netten: ['a.b.c', ...] (de eigen thuisnetten van deze computer, als bekend: die gaan voor) }
  function volgHart(t, h, o) {
    const op = o || {};
    const tijd = op.nu || Date.now();
    if (!t || !h || !h.id || !h.t || tijd - h.t > HARTSLAG_VERS_MS) return null;
    const thuis = (Array.isArray(h.adressen) ? h.adressen : []).filter(isThuisNet);
    if (!thuis.length) return { id: h.id };
    const netten = Array.isArray(op.netten) ? op.netten : [];
    const net = (ip) => ip.split('.').slice(0, 3).join('.');
    const huidig = hostVan(t.jarvis) || hostVan(t.adres);
    const host = thuis.includes(huidig) ? huidig : (thuis.find((ip) => netten.includes(net(ip))) || thuis[0]);
    const jarvis = `http://${host}:${Number(h.poort) || JARVIS_POORT}`;
    const motor = !!(h.motor && h.motor.klaar) && !!op.code;
    const adres = motor ? `http://${host}:${MOTOR_POORT}` : `http://${host}:${poortVan(t.adres) || OLLITERT_POORT}`;
    return { id: h.id, adres, jarvis, motor };
  }
  // 543: EEN NIEUWE TELEFOON DIE ALLEEN EEN HARTSLAG STUURT (24 oktober): er is nog geen kaart, dus volgHart heeft niets
  // om bij te werken. Terug: de kaarten die Veronica zou MAKEN (na een controle op het adres, zie veronica.js), of een lege lijst.
  // Alleen een verse hartslag met een thuisadres, en nooit een toestel dat al een kaart heeft (op id of op adres).
  function kaartenUitHarten(harten, telefoons, o) {
    const op = o || {};
    const tijd = op.nu || Date.now();
    const netten = Array.isArray(op.netten) ? op.netten : [];
    const net = (ip) => ip.split('.').slice(0, 3).join('.');
    const lijst = Array.isArray(telefoons) ? telefoons : [];
    // 557: alleen een regel ZONDER id blokkeert (die krijgt in ruimSpokenOp dit id). Een spook met een ANDER id op hetzelfde adres
    // niet meer: zo kreeg een nieuwe telefoon geen tegel. Dat spook ruimt ruimSpokenOp daarna op (de verse hartslag bewijst het adres).
    const hosts = new Set(lijst.filter((t) => !t.id).flatMap((t) => [hostVan(t.adres), hostVan(t.jarvis)]).filter(Boolean));
    const uit = [];
    for (const h of Array.isArray(harten) ? harten : []) {
      if (!h || !h.id || !h.t || tijd - h.t > HARTSLAG_VERS_MS) continue;
      if (lijst.some((t) => t.id === h.id) || uit.some((k) => k.id === h.id)) continue;
      const thuis = (Array.isArray(h.adressen) ? h.adressen : []).filter(isThuisNet);
      if (!thuis.length || thuis.some((ip) => hosts.has(ip))) continue;
      const host = thuis.find((ip) => netten.includes(net(ip))) || thuis[0];
      const motor = !!(h.motor && h.motor.klaar) && !!op.code;
      uit.push({ id: h.id, naam: String(h.naam || '').trim().slice(0, 40) || `Telefoon ${host.split('.')[3]}`,
        adres: motor ? `http://${host}:${MOTOR_POORT}` : `http://${host}:${OLLITERT_POORT}`, jarvis: `http://${host}:${Number(h.poort) || JARVIS_POORT}`,
        kern: h.voorkeur === 'kern', alternatieven: [], plek: null, sleutel: motor ? op.code : '', motor });
    }
    return uit;
  }
  // 557: SPOKEN OPRUIMEN. Een telefoon = een vast toestel-id, nooit een naam of een adres. Na een ander wifi of een nieuwe naam
  // stond dezelfde telefoon er drie keer in ("Rektelefoon 2" op het oude net, "Telefoon .76", een naam met een eigenaar erin), en een nieuwe
  // telefoon kreeg geen tegel als een spook zijn adres nog had (een nieuwe telefoon op 24 oktober). Vijf stappen, allemaal uit metingen:
  //  1. een regel zonder id krijgt het id dat JARVIS op dat adres ZELF noemde (statusIds), anders dat van een verse hartslag die
  //     dat adres meldt (alleen als het er precies een is);
  //  2. laatst gezien = het jongste van: direct antwoord (laatst per adres), verse hartslag, of wat er al bewaard stond; een regel
  //     zonder enige datum krijgt NU (een spook wordt pas na drie dagen stilte opgeruimd, nooit bij het eerste laden);
  //  3. dezelfde id = EEN regel: wie direct antwoordde, dan wiens adres in de verse hartslag staat, dan de jongste; de naam uit de
  //     hartslag; de andere adressen gaan mee als alternatieven;
  //  4. twee ids op hetzelfde adres: wie dat adres NU bewijst (JARVIS noemde daar zijn id, of zijn verse hartslag meldt het) blijft;
  //  5. drie dagen niets gehoord = weg (de beheerder nooit vanzelf).
  // Terug: { lijst, samen: [{ naam, met: [...] }], weg: [{ naam, adres, reden }], veranderd }.
  const SPOOK_MS = 3 * 24 * 3600 * 1000;
  function ruimSpokenOp(telefoons, o) {
    const op = o || {};
    const tijd = op.nu || Date.now();
    const statusIds = op.statusIds || {};
    const laatst = op.laatst || {};
    const vers = (Array.isArray(op.harten) ? op.harten : []).filter((h) => h && h.id && h.t && tijd - h.t <= HARTSLAG_VERS_MS);
    const hartVan = (id) => vers.find((h) => h.id === id) || null;
    const hosts = (t) => [hostVan(t.jarvis), hostVan(t.adres)].filter(Boolean);
    const samen = []; const weg = [];
    let veranderd = false;
    let lijst = (Array.isArray(telefoons) ? telefoons : []).filter(Boolean).map((t) => Object.assign({}, t));
    // 1. id leren
    for (const t of lijst) {
      if (t.id) continue;
      const h = hosts(t);
      let id = h.map((x) => statusIds[x]).find(Boolean) || null;
      if (!id) { const k = vers.filter((x) => (x.adressen || []).some((a) => h.includes(a))); if (k.length === 1) id = k[0].id; }
      if (id) { t.id = id; veranderd = true; }
    }
    // 2. laatst gezien
    for (const t of lijst) {
      const hv = t.id ? hartVan(t.id) : null;
      const l = Math.max(Number(t.laatstGezien) || 0, Number(laatst[t.adres]) || 0, Number(laatst[t.jarvis]) || 0, hv ? Number(hv.ontvangen || hv.t) || 0 : 0);
      const nieuw = l || tijd;
      if (nieuw !== t.laatstGezien) { t.laatstGezien = nieuw; veranderd = veranderd || !l; }
    }
    // 3. dezelfde id = een regel
    const direct = (t) => Math.max(Number(laatst[t.adres]) || 0, Number(laatst[t.jarvis]) || 0);
    const score = (t) => ((tijd - direct(t) < 10 * 60 * 1000) ? 4 : 0) + (t.id && hartVan(t.id) && hosts(t).some((x) => (hartVan(t.id).adressen || []).includes(x)) ? 2 : 0) + (t.kern ? 1 : 0);
    const perId = new Map();
    const uit = [];
    for (const t of lijst) {
      if (!t.id) { uit.push(t); continue; }
      const groep = perId.get(t.id);
      if (!groep) { perId.set(t.id, [t]); uit.push(t); } else groep.push(t);
    }
    for (const [id, groep] of perId) {
      if (groep.length < 2) continue;
      const winnaar = groep.slice().sort((a, b) => score(b) - score(a) || (b.laatstGezien || 0) - (a.laatstGezien || 0))[0];
      const anderen = groep.filter((t) => t !== winnaar);
      const hv = hartVan(id);
      const w = Object.assign({}, winnaar, {
        naam: (hv && String(hv.naam || '').trim()) || winnaar.naam,
        kern: groep.some((t) => t.kern),
        laatstGezien: Math.max(...groep.map((t) => t.laatstGezien || 0)),
        alternatieven: [...new Set([].concat(winnaar.alternatieven || [], ...anderen.map((t) => [t.adres].concat(t.alternatieven || []))).filter((a) => a && a !== winnaar.adres))],
      });
      const i = uit.indexOf(groep[0]);
      uit[i] = w;
      samen.push({ naam: w.naam, met: anderen.map((t) => `${t.naam} (${hostVan(t.jarvis) || hostVan(t.adres)})`) });
      veranderd = true;
    }
    lijst = uit;
    // 4. twee ids op een adres: wie het adres nu bewijst blijft
    const bewijst = (t, host) => statusIds[host] === t.id || !!(t.id && hartVan(t.id) && (hartVan(t.id).adressen || []).includes(host));
    lijst = lijst.filter((t) => {
      const host = hostVan(t.jarvis) || hostVan(t.adres);
      if (!host || t.kern) return true;
      const ander = lijst.find((x) => x !== t && x.id && x.id !== t.id && (hostVan(x.jarvis) || hostVan(x.adres)) === host && bewijst(x, host));
      if (ander && !bewijst(t, host)) { weg.push({ naam: t.naam, adres: host, reden: `${ander.naam} gebruikt nu dit adres` }); veranderd = true; return false; }
      return true;
    });
    // 5. drie dagen stilte
    lijst = lijst.filter((t) => {
      if (t.kern || tijd - (t.laatstGezien || tijd) <= SPOOK_MS) return true;
      weg.push({ naam: t.naam, adres: hostVan(t.jarvis) || hostVan(t.adres), reden: `al ${Math.round((tijd - t.laatstGezien) / 86400000)} dagen niets gehoord` });
      veranderd = true;
      return false;
    });
    return { lijst, samen, weg, veranderd };
  }
  // 539: accu en temperatuur ook als het wifi niet lukt: uit een verse hartslag (via de brievenbus). Terug { temp, accu, laadt, t } of null.
  function hartMeting(h, tijd) {
    if (!h || !h.t || (tijd || Date.now()) - h.t > HARTSLAG_VERS_MS) return null;
    const temp = typeof h.temp === 'number' ? h.temp : null;
    const accu = typeof h.accu === 'number' ? h.accu : null;
    if (temp === null && accu === null) return null;
    return { temp, accu, laadt: h.laadt === true, t: h.t };
  }
  function metHartslagen(lijst, per, nuMs) {
    const vers = Object.values(per || {}).filter((h) => h && Array.isArray(h.adressen) && h.adressen.length && nuMs - h.t <= HARTSLAG_VERS_MS)
      .sort((a, b) => (b.rol === 'baas') - (a.rol === 'baas') || b.t - a.t);
    const voor = [];
    for (const h of vers) for (const ip of h.adressen) { const a = `http://${ip}:${Number(h.poort) || JARVIS_POORT}`; if (isThuisNet(ip) && !voor.includes(a)) voor.push(a); }
    return voor.concat((lijst || []).filter((a) => !voor.includes(a)));
  }
  const hartslagVers = (per, nuMs) => Object.values(per || {}).some((h) => h && Array.isArray(h.adressen) && h.adressen.length && nuMs - h.t <= HARTSLAG_VERS_MS);
  const ledenBriefVers = (brief, nuMs) => !!(brief && Array.isArray(brief.leden) && brief.leden.length && (nuMs - brief.t) <= LEDEN_VERS_MS);

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
        ? 'Geen directe wifi-verbinding met de telefoons. Op een gastnetwerk is dat normaal: alles gaat dan via de brievenbus. Staan ze aan en staat JARVIS open?'
        : `Geen directe wifi-verbinding met de telefoons. Op een gastnetwerk is dat normaal: alles gaat dan via de brievenbus. Heeft Chrome gevraagd om het lokale netwerk en zei je nee, dan: ${terug}`;
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
      denker: { prio: 2, tag: 'speech_balloon' },   // 481: zelfde als JARVIS (waarschuw.js)
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
    if (r === 'baas') delen.push('🛠 Beheerder');   // 495: de telefoon die de rij leidt heet beheerder; Veronica is de andere beheerder
    else if (r === 'werker') delen.push('Werker');
    // 481: de schuif Sparen. Veronica TOONT hem; omzetten kan alleen op de telefoon zelf.
    if (status && status.gespaard && status.gespaard.waarde === true && tijd - status.gespaard.t <= MAX_LEEFTIJD_MS) delen.push('🔋 Gespaard');
    if (status && status.dagelijks && status.dagelijks.waarde && tijd - status.dagelijks.t <= MAX_LEEFTIJD_MS) delen.push('📱 Dagelijkse telefoon');   // 495
    if (status && status.zandbak && status.zandbak.waarde === true && tijd - status.zandbak.t <= MAX_LEEFTIJD_MS) delen.push('🧪 Zandbak');   // 496
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
  // 548: DE VERBINDING IN EEN KLEUR, met de reden. De relay is de vaste route (hartslag elke 30 s, Veronica kijkt elke 15 s), het
  // wifi-adres een versnelling. Groen = binnen 90 s een teken van leven, oranje = 90 tot 300 s, rood = langer of nog nooit. De tijd
  // van de hartslag is die van de RELAY (ontvangen), niet die van de telefoon. o: { direct (ms, laatste antwoord over het wifi),
  // hart (ms), relay (true = Veronica kent een relay), adres (het bewaarde adres), hartAdressen (wat de telefoon zelf meldt) }.
  const VERBINDING_GROEN_MS = 90 * 1000;
  const VERBINDING_ORANJE_MS = 300 * 1000;
  // 552: HOE VAAK STUURT DEZE TELEFOON ZIJN HARTSLAG? Een JARVIS van 1.9.68 zegt het zelf (elke); 1.9.67 klopte al elke 30 s. Een oudere zegt niets: via de relay
  // stuurde hij eens per tien minuten (en eens per minuut als er iets veranderde), via de brievenbus hoogstens eens per 100 minuten.
  // Veronica kleurde vroeger elke telefoon na 90 s oranje en na vijf minuten rood -- een oude JARVIS sprong zo steeds van groen naar
  // rood en terug, terwijl hij gewoon op tijd was.
  const OUDE_RELAY_ELKE_MS = 10 * 60 * 1000;
  const OUDE_BUS_ELKE_MS = 100 * 60 * 1000;
  function verwachtElke(h) {
    if (!h) return 0;
    if (typeof h.elke === 'number' && h.elke > 0) return h.elke;
    if (h.relay && h.versie && vergelijkVersie(h.versie, '1.9.67') >= 0) return 30 * 1000;   // 1.9.67 klopte al elke 30 s, maar zei het nog niet
    return h.relay ? OUDE_RELAY_ELKE_MS : OUDE_BUS_ELKE_MS;
  }
  // 552: WAAROM VALT DEZE TELEFOON WEG? De echte redenen uit zijn laatste hartslag, in gewone taal, de belangrijkste eerst. Terug een
  // lijst { code, zin }; leeg = niets bijzonders gemeld. Alleen wat de telefoon zelf meldde; niets wordt geraden.
  function wegRedenen(h, tijd, o) {
    const op = o || {};
    const uit = [];
    if (!h || !h.t) return uit;
    const nu = tijd || Date.now();
    if (h.pauze) uit.push({ code: 'uit', zin: 'JARVIS staat uit (de Uit-knop of de noodstop). Zet hem weer aan met "JARVIS aan".' });
    if (h.versie && vergelijkVersie(h.versie, '1.9.67') < 0) {
      uit.push({ code: 'oud', zin: `Deze telefoon draait JARVIS ${h.versie}. Die stuurt zijn hartslag ${h.relay ? 'eens per tien minuten' : 'hoogstens eens per anderhalf uur'}, dus hij lijkt tussendoor weg. Werk hem bij naar ${op.nieuwste || JARVIS_NIEUWSTE}; vraagt de telefoon erom, tik dan op Installeren.` });
    }
    const st = stopZin(h, nu);
    if (st) uit.push({ code: 'gestopt', zin: `Android ${st}.` });
    const sl = slaapZin(h, nu);
    if (sl) uit.push({ code: 'slaap', zin: `JARVIS ${sl}.` });
    if (h.motor && h.motor.dicht > 0 && nu - (h.motor.dichtT || 0) < 10 * 60 * 1000) {
      uit.push({ code: 'code', zin: 'De motor van deze telefoon kreeg steeds een verkeerde code van een andere telefoon of van Veronica en zet die beller telkens een minuut buiten. Waarschijnlijk heeft een telefoon een oude rij-code: scan op die telefoon de QR van Veronica opnieuw.' });
    }
    if (h.batterijVrij === false && !h.laadt) uit.push({ code: 'batterij', zin: 'De batterij van JARVIS staat niet op Onbeperkt en hij hangt niet aan de lader: dan mag Android hem laten slapen.' });
    if (h.sparen) uit.push({ code: 'spaart', zin: 'Deze telefoon spaart (de schuif op de telefoon): hij neemt geen werk aan.' });
    if (h.dagelijks) uit.push({ code: 'dagelijks', zin: 'Dit is de dagelijkse telefoon: hij rust terwijl je hem gebruikt.' });
    if (h.motor && h.motor.aan && h.motor.fase === 'fout') uit.push({ code: 'motor', zin: 'De eigen motor staat aan maar liep vast; Veronica vraagt hem vanzelf opnieuw te starten.' });
    // 578: EEN TELEFOON KAN VERBONDEN ZIJN (groen) EN TOCH NIETS DOEN. Twee redenen die nergens anders stonden: te oud voor een
    // eigen model, en een model dat nog laadt of wacht. Zo weet je dat een stille, groene telefoon niet kapot is.
    if (h.motor && (h.motor.teOud === true || h.motor.soort === 'te-oud')) {
      uit.push({ code: 'te-oud', zin: 'Deze telefoon is te oud voor een eigen model. Hij helpt wel met kleine klussen (zoeken, controleren), maar niet met een gesprek of een vertaling.' });
    } else if (h.motor && h.motor.aan && h.motor.klaar === false && (h.motor.fase === 'laden' || h.motor.fase === 'wacht' || h.motor.fase === 'download')) {
      const watZin = h.motor.fase === 'download' ? 'haalt het model nog op' : h.motor.fase === 'wacht' ? 'wacht om het model te laden' : 'laadt het model nog';
      const pct = typeof h.motor.procent === 'number' && h.motor.procent > 0 && h.motor.procent < 100 ? ` (${Math.round(h.motor.procent)}%)` : '';
      uit.push({ code: 'model-laadt', zin: `De eigen motor staat aan, maar ${watZin}${pct}: hij neemt nog geen werk aan tot het model klaar is.` });
    }
    return uit;
  }
  // 554: BIJWERKEN PER TELEFOON, uit zijn eigen hartslag (ook op een gastnetwerk). Wat de telefoon zegt (bijwerk.stap), en of de
  // knop "Werk nu bij" kan: vanaf JARVIS 1.9.69 haalt de telefoon dan de nieuwe versie op en zet een melding (een tik daarop, dan
  // Bijwerken). Een oudere JARVIS kent die roep niet: die moet EEN keer met de hand, en dat staat er in gewone taal.
  const BIJWERK_NU_VANAF = '1.9.69';
  // 556: DE KORTE REGEL OP DE TEGEL: accu, warmte, model, wat hij doet, snelheid, slimheid en (op de geheugen-telefoon) de laatste
  // kopie. Alles gemeten; wat er niet is heet "onbekend" of "nog niet gemeten", nooit een gok.
  // 556: ONDERDEEL VANZELF VERVANGEN. Te warm (vanaf 42 graden) of bijna leeg zonder lader (onder 15%) = even geen werk; terug zodra
  // hij is afgekoeld (onder 38) en weer genoeg accu heeft (20% of aan de lader). Alleen uit een VERSE hartslag; onbekend = niets doen.
  // Een onderdeel dat een mens zelf vervangt (de knop op Meer) blijft vervangen tot een mens het terugzet.
  function vervangBesluit(h, nu, o) {
    const x = o || {};
    if (!h || !h.t || (nu || Date.now()) - h.t > (x.versMs || 10 * 60 * 1000)) return null;
    const warm = typeof h.temp === 'number' && h.temp >= 42;
    const leeg = typeof h.accu === 'number' && h.accu < 15 && h.laadt !== true;
    if (!x.vervangen && (warm || leeg)) return { doe: 'vervang', zin: warm ? `te warm (${String(Math.round(h.temp * 10) / 10).replace('.', ',')} °C); hij krijgt geen werk tot hij is afgekoeld` : `bijna leeg (${Math.round(h.accu)}%, niet aan de lader); hij krijgt geen werk tot hij weer laadt` };
    const koel = typeof h.temp !== 'number' || h.temp < 38;
    const genoeg = h.laadt === true || typeof h.accu !== 'number' || h.accu >= 20;
    if (x.vervangen && x.vanzelf && koel && genoeg) return { doe: 'terug', zin: 'weer afgekoeld en genoeg accu; hij doet weer mee' };
    return null;
  }
  // 556: FENNA VANZELF METEN: elke nacht (tussen 2 en 5 uur) een keer, en een keer na elke nieuwe JARVIS-versie of een ander model.
  function slimMeetBesluit(o) {
    const x = o || {};
    const d = new Date(x.nu || Date.now());
    const dag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (x.handtekening && x.handtekening !== x.vorigeHandtekening) return { meet: true, reden: 'nieuwe versie of ander model', dag };
    if (d.getHours() >= 2 && d.getHours() < 5 && x.nachtDag !== dag) return { meet: true, reden: 'de nachtmeting', dag };
    return { meet: false, dag };
  }
  function tegelKort(o, tijd) {
    const x = o || {};
    const komma = (v) => String(v).replace('.', ',');
    const delen = [];
    delen.push(typeof x.accu === 'number' ? `accu ${Math.round(x.accu)}%${x.laadt ? ' (laadt)' : ''}` : 'accu onbekend');
    delen.push(typeof x.temp === 'number' ? `${komma(Math.round(x.temp * 10) / 10)} °C` : 'warmte onbekend');
    delen.push(x.model ? String(x.model).slice(0, 40) : 'geen model');
    delen.push(x.doet ? String(x.doet).slice(0, 80) : 'rustig');
    delen.push(typeof x.tps === 'number' && x.tps > 0 ? `±${komma(Math.round(x.tps * 10) / 10)} tokens per seconde` : 'snelheid nog niet gemeten');
    delen.push(typeof x.slim === 'number' ? `slimheid ${Math.round(x.slim * 100)}%` : 'slimheid nog niet gemeten');
    if (x.geheugen) delen.push(x.kopieT ? `laatste kopie ${klokZin(x.kopieT).slice(0, 5)}${(tijd || Date.now()) - x.kopieT > 36 * 3600 * 1000 ? ' (ouder dan een dag)' : ''}` : 'nog geen kopie');
    return delen.join(' · ');
  }
  // 556b: DE STEKKERS IN DE TEGEL. Een regel in de tegel van de beheerder (die schakelt ze): per stekker aan of uit, en bij een
  // meter het vermogen. Alleen verse metingen; ouder of onbekend = "onbekend". Geen knop: de handknop staat op Meer.
  function stekkerKort(stekkers, metingen, tijd) {
    const lijst = Array.isArray(stekkers) ? stekkers.filter(Boolean) : [];
    if (!lijst.length) return '';
    const nuT = tijd || Date.now();
    const vers = (m) => m && typeof m.t === 'number' && nuT - m.t <= MAX_LEEFTIJD_MS;
    const ROL = { lader: 'lader', ventilator: 'ventilator', meter: 'meter' };
    const delen = lijst.map((k) => {
      const m = (metingen || {})[k.ip] || {};
      const naam = ROL[k.rol] || 'stekker';
      if (k.rol === 'meter') return vers(m.watt) && typeof m.watt.waarde === 'number' ? `meter ${Math.round(m.watt.waarde)} W` : 'meter onbekend';
      return vers(m.aan) && typeof m.aan.waarde === 'boolean' ? `${naam} ${m.aan.waarde ? 'aan' : 'uit'}` : `${naam} onbekend`;
    });
    return `Stekkers: ${delen.join(' · ')}`;
  }
  function bijwerkRegel(h, nieuwste) {
    if (!h || !h.t || !h.versie) return null;
    const b = h.bijwerk && typeof h.bijwerk === 'object' ? h.bijwerk : null;
    // de telefoon zelf kan een nieuwere versie kennen dan Veronica (die staat in de postbus): dan geldt die
    let doel = nieuwste || JARVIS_NIEUWSTE;
    if (b && b.nieuw && vergelijkVersie(b.nieuw, doel) > 0) doel = b.nieuw;
    const achter = vergelijkVersie(h.versie, doel) < 0;
    if (!achter && !b) return null;
    const kan = vergelijkVersie(h.versie, BIJWERK_NU_VANAF) >= 0;
    const code = b && b.code ? String(b.code) : (achter ? (kan ? 'achter' : 'met-de-hand') : '');
    // 566: of de laatste update stil ging (Android 12+, zonder tik) of dat Android toch een tik vroeg
    const stilZin = b && b.stil === true ? 'Werkte zichzelf bij zonder tik. '
      : b && b.stil === false ? 'Android vroeg een tik op Bijwerken. ' : '';
    let zin = '';
    if (b && b.stap) zin = `${stilZin}De telefoon zegt: ${b.stap}`;
    else if (stilZin) zin = stilZin.trim();
    else if (achter && kan) zin = `Er is een nieuwere JARVIS (${doel}). Tik op Werk nu bij: de telefoon haalt hem op en zet een melding; tik daar op de telefoon op, en daarna op Bijwerken.`;
    else if (achter) zin = `Deze telefoon draait JARVIS ${h.versie}; die kan nog niet op afstand worden bijgewerkt. Een keer met de hand: open JARVIS op de telefoon, Instellingen, Versie, tik op Download en installeer en daarna op Bijwerken. Gebeurt er niets, open dan de downloadlink uit de mail in Chrome op die telefoon en tik op Installeren. Daarna gaat het voortaan met een tik.`;
    return zin ? { code, zin, knop: achter && kan } : null;
  }
  // 567: ZELFHERSTEL. Wat JARVIS bij de laatste start of hartslag vanzelf rechttrok (rol/dagelijks). Zo hoeft de eigenaar nooit
  // zelf in de instellingen te zoeken: hij ziet gewoon dat het goed staat. Leeg = niets te herstellen.
  function herstelRegel(h) {
    const t = h && typeof h.herstel === 'string' ? h.herstel.trim() : '';
    return t ? `JARVIS zette dit vanzelf goed: ${t}.` : null;
  }
  // 570: WAAR de telefoon staat, uit de hartslag (locatie). Het etiket komt van de eigenaar; de soort bepaalt de regel.
  // Geen etiket -> een neutraal woord. null = plek onbekend (dan geen regel).
  function locatieRegel(h) {
    const l = h && h.locatie && typeof h.locatie === 'object' ? h.locatie : null;
    if (!l || !['gast', 'hoofd', 'hotspot'].includes(l.soort)) return null;
    const naam = (l.naam || '').trim() || (l.soort === 'hotspot' ? 'de hotspot' : l.soort === 'hoofd' ? 'het hoofdwifi' : 'een gastnetwerk');
    if (l.soort === 'hoofd') return `Plek: ${naam} -- hoofdwifi, geen beperkingen.`;
    if (l.soort === 'hotspot') return `Plek: ${naam} -- reserve (hotspot), zuinig.`;
    return `Plek: ${naam} -- gastnetwerk, zuinig (aanhaken via de postbus, grote downloads 's nachts).`;
  }
  // 572: het dagbudget van het gastnetwerk (gastbudget in de hartslag): ± MB vandaag en of het plafond bereikt is. Alleen op
  // een gastnetwerk (soort 'gast'); anders geen regel. null = onbekend.
  function gastbudgetRegel(h) {
    const b = h && h.gastbudget && typeof h.gastbudget === 'object' ? h.gastbudget : null;
    const l = h && h.locatie && typeof h.locatie === 'object' ? h.locatie : null;
    if (!b || !l || l.soort !== 'gast') return null;
    const mb = (Number(b.mb) || 0).toFixed(1);
    const vol = (Number(b.mb) || 0) >= 50;
    return vol
      ? `Dataplafond gastnetwerk bereikt (± ${mb} MB vandaag): alles behalve de hartslag pauzeert tot morgen.`
      : `± ${mb} van 50 MB vandaag (gastnetwerk, zuinig).`;
  }
  function verbinding(o, tijd) {
    const x = o || {};
    const getal = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
    const d = getal(x.direct);
    const h = getal(x.hart);
    const laatst = Math.max(d, h);
    // 552: de grenzen schuiven mee met hoe vaak deze telefoon hoort te kloppen (elke): groen tot een hartslag plus een minuut,
    // oranje tot twee gemiste. Nooit strenger dan 90 s / 300 s.
    const elke = getal(x.elke);
    const groenMs = Math.max(VERBINDING_GROEN_MS, elke + 60 * 1000);
    const oranjeMs = Math.max(VERBINDING_ORANJE_MS, 2 * elke + 60 * 1000);
    const adres = String(x.adres || '').replace(/^https?:\/\//, '');
    const gemeld = (Array.isArray(x.hartAdressen) ? x.hartAdressen : []).map((a) => String(a).replace(/^https?:\/\//, ''));
    const host = adres.split(':')[0];
    const ander = host && gemeld.length && !gemeld.some((a) => a.split(':')[0] === host) ? gemeld[0] : '';
    const oudAdres = ander ? ` Het adres ${adres} is oud; de telefoon meldt nu ${ander}.` : '';
    if (!laatst) return { kleur: 'rood', zin: `Nog niets gehoord: geen antwoord over het wifi en geen hartslag${x.relay ? '' : ' (en de relay staat uit)'}.${oudAdres}` };
    const oud = Math.max(0, (tijd || Date.now()) - laatst);
    const weg = d && d >= h ? 'rechtstreeks over het wifi' : (x.relay ? 'via de relay' : 'via de brievenbus');
    const sec = Math.round(oud / 1000);
    const wanneer = sec < 120 ? `${sec} s geleden` : `${Math.round(sec / 60)} min geleden`;
    if (oud < groenMs) return { kleur: 'groen', zin: `Verbonden, ${weg} (${wanneer}).${d && d >= h ? '' : ' Rechtstreeks lukt nu niet; dat is geen probleem.'}${oudAdres}` };
    const zonderRelay = x.relay ? '' : ' Zonder relay komt de hartslag hoogstens eens per half uur: zet de relay aan in Instellingen.';
    if (oud < oranjeMs) return { kleur: 'oranje', zin: `Laatste teken ${wanneer}, ${weg}. Een hartslag of twee gemist: wifi even weg, of de telefoon slaapt net.${zonderRelay}${oudAdres}` };
    return { kleur: 'rood', zin: `Al ${wanneer} niets gehoord (laatst ${weg}). Staat de telefoon uit, is JARVIS dicht, of zet het systeem hem stil? Kijk in de zelftest van de telefoon.${zonderRelay}${oudAdres}` };
  }
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
  // 533: EEN STEKKER, EEN SLEUTEL. Met een id (JARVIS 1.9.64) is dat het id; anders naam + rol. Een oude JARVIS meldt geen id,
  // dan staat de stekker onder naam + rol. stekkerSleutel(k) is wat de kaart vraagt: het eerste dat de baas kent.
  function stekkerSleutels(s) {
    const naam = typeof s.naam === 'string' ? s.naam.slice(0, 200) : '';
    const uit = [];
    if (typeof s.id === 'string' && s.id) uit.push(`id:${s.id.slice(0, 40)}`);
    uit.push(`${naam}|${typeof s.rol === 'string' ? s.rol : ''}`);
    return uit;
  }
  const stekkerSleutel = (s, per) => { const ks = stekkerSleutels(s); return (per && ks.find((k) => k in per)) || ks[0]; };
  // 533: twee stekkers met dezelfde naam en geen id = een oude JARVIS schakelt met de handknop de EERSTE met die naam.
  const dubbeleStekkerNamen = (lijst) => { const n = {}; for (const s of lijst || []) if (s && !s.id && s.naam) n[s.naam] = (n[s.naam] || 0) + 1; return Object.keys(n).filter((x) => n[x] > 1); };
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
    // 533: per SLEUTEL (stekkerSleutel), niet per naam: twee stekkers met dezelfde Tasmota-naam ("Tasmota") liepen in elkaar over.
    for (const s of Array.isArray(d.stekkers) ? d.stekkers : []) if (s && tekst(s.naam) && ['auto', 'aan', 'uit'].includes(s.hand)) for (const k of stekkerSleutels(s)) handPer[k] = s.hand;
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
      const m = { t: bij(s.leeftijdMs), aan: s.aan === true ? true : s.aan === false ? false : null, watt: g(s.watt), kwh: g(s.kwh), vandaag: g(s.vandaag), spanning: g(s.spanning), meet: s.meet === false ? false : s.meet === true ? true : null };
      for (const k of stekkerSleutels(s)) stekkerPer[k] = m;
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
  return { verwachtElke, wegRedenen, OUDE_RELAY_ELKE_MS, verbinding, VERBINDING_GROEN_MS, VERBINDING_ORANJE_MS, kaartenUitHarten, hartVoorTelefoon, volgHart, hartMeting, leesLedenIds, MOTOR_POORT, meetuurZin, meetboekBij, meetSamenvatting, stopZin, slaapZin, gezienZin, STOP_REDEN, rekBesluit, rekBesluitHart, wieRekent, tpsVan, wieDoetWat, gidsSamenvatting, werkerWensStap, wifiUitleg, WERKER_WENS_MS, WERKER_WIFI_MS, WERKER_BUS_MS, rekWerker, rekWerkerKnop, proefPerTelefoon, REK_KIJK_MS, REK_MOTOR_MS, rijBriefOnderwerp, rijBriefVerzoek,
    alternatieveAdressen, toestelZin, leesMotor, motorZin, motorAdres, MOTOR_FASEN, leesAikern, kernZin, begrijp, magSpreken, wavVan, dagdeel, statusFeiten, leesEigenaar, PLEK_NAAM, rolZin, jongsteMeting, oudZin, Ntfy, leesNtfy, KARAKTERS, veronicaZin, baasUitStatus, lnaUitleg, herstelKernAdres, wisselKern, JARVIS_NIEUWSTE, rolNaam, ontdubbelTelefoons, ruimSpokenOp, SPOOK_MS, vergelijkVersie, nieuwsteVersie, versieZin, leesLeden, rondvraagLijst, voegBekendToe, vindUitleg, MAX_BEKEND, herstelPlan, herstelZin, GANGBARE_NETTEN,
    gezondSamenvatting, GEZOND_VERS_MS, leesZonStroom, stekkerSleutels, stekkerSleutel, dubbeleStekkerNamen, leesPakket, koppelQrTekst, leesUpdateSleutel,
    SLEUTEL_RE, VERONICA_QR_MS, veronicaQrTekst, BRIEF_SERVER, briefOnderwerp, ledenOnderwerp, leesLedenBrief, metLedenBrief, metHartslagen, hartslagVers, HARTSLAG_VERS_MS, ledenBriefVers, LEDEN_VERS_MS, briefPollUrl, briefStroomUrl, netVan, leesBrief, eigenAdresUitKandidaat, subnetAdressen, nieuweSleutel, veronicaBewijs, veronicaOpen,
    MAX_LEEFTIJD_MS, JARVIS_POORT, OLLITERT_POORT, HITTE,
    leesSamenwerken, TREDE_ZIN, motorKandidaat, magNaarBuiten, leesVolLokaal, leesNalees, meting, vakje, leeftijdZin, klokZin, leesHealth, leesStatus, leesStekker, motorKlaarZin, meterZin, leesTarief, leesKast, leesTokenprijs, TOKENPRIJS_STANDAARD, verbruikRegel, TARIEF_STANDAARD, scanZin, hitteNaam, ruweStand,
    vervangBesluit, slimMeetBesluit, stekkerKort, tegelKort, bijwerkRegel, herstelRegel, locatieRegel, gastbudgetRegel, BIJWERK_NU_VANAF, isEigenNet, normaalAdres, leesBrievenbus, brievenbusUitleg, leesVertrouwd, leesNieuweTelefoon, overzicht, leesNieuwKoppel, leesPostbusAdres, adresGetekend, postbusQrTekst, adresVers, leesPlakCode, ADRES_GELDIG_MS, leesApkAdres, pakUit, leesMail, geldigTot, nogGeldig, totZin, bijwerkHulp, VERS_ADRES_VANAF, gekoppeldZin, nieuweNamen, GANGBARE_NETTEN, isThuisNet, thuisAdressenUitKandidaten, zoekPlan, zoekZin, NOG_NIET_ZIN, koppelStand, GEEN_LNA_ZIN, BRIEF_WACHT_MS, VERONICA_VERSIE, OLLITERT_PAGINA, WACHT_ZIN, rekOverzicht, REK_WARM, REK_HEET, RESERVES, reserveZin, leesQr, geenAntwoordZin, proefAdres, lnaOpties, kiesTelefoon, maakSseLezer, zonderDenken,
  };
}));
