// ===================================================================
// 514 (19 oktober): DE POSTBUS ALS ONTMOETINGSPLEK -- byte-gelijk in JARVIS (www/) en Veronica (tools/veronica/)
// ===================================================================
//
// Het ontwerp zoals de eigenaar het wil: de postbus (Object Storage, alleen via ondertekende adressen uit het pakket) is ALLEEN
// de plek waar toestellen elkaar vinden. Zodra twee toestellen elkaar daar gevonden hebben, stappen ze over op een gratis
// rechtstreekse lijn (het wifi, en anders weet Bluetooth dat de ander in de buurt is) en zwijgt de postbus op een zeldzame
// hartslag na. Valt de rechtstreekse lijn weg, dan weer de postbus: hartslag en opdrachten elke drie minuten.
//
// Hoe:
//  - Het pakket heeft ACHT genummerde PLEKKEN (de server weet niets van toestel-id's). Plek 0 is voor Veronica, 1-7 voor de
//    telefoons. Een telefoon CLAIMT een plek: zijn hart erin, twintig seconden wachten, teruglezen. Staat er dan een ander
//    toestel-id, dan was die eerst en kiest hij de volgende keer een andere plek.
//  - Een plek is VRIJ als er geen hart ligt, als het hart ouder is dan zeven dagen, of als het een hart is van een toestel met
//    DEZELFDE naam dat al een half uur zweeg (dezelfde telefoon, opnieuw geinstalleerd: hij krijgt zijn plek terug).
//  - Het HART is dezelfde korte regel als de hartslag op de brievenbus (500), plus de plek, de lijn naar elk ander toestel, het
//    tempo en de laatste opdrachten die gedaan zijn. Geen sleutel, geen code, geen adres buiten het eigen net.
//  - Een OPDRACHT is een roep (dezelfde soorten als /jarvis/roep) in de opdrachtenbak van de plek van de ontvanger,
//    VERSLEUTELD met een sleutel uit de koppelcode van de rij, met een tijd (hoogstens een uur oud) en een eenmalig nummer.
//    De ontvanger verwerkt hem op precies dezelfde manier als een roep over het wifi en zet in zijn hart dat hij hem deed.
// De server wordt er NIET wakker van: alles gaat rechtstreeks naar de bucket. Er komt geen dienst bij die geld kost.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./hartslag.js'));
  else wortel.Ontmoet = fabriek(wortel.Hartslag);
}(typeof self !== 'undefined' ? self : this, function (Hartslag) {
  'use strict';

  const AANTAL = 8;
  const VERONICA_PLEK = 0;
  const CLAIM_WACHT_MS = 20 * 1000;
  const PLEK_OUD_MS = 7 * 24 * 3600 * 1000;
  const ZELFDE_NAAM_STIL_MS = 30 * 60 * 1000;
  const TEMPO = { postbus: 3 * 60 * 1000, rechtstreeks: 15 * 60 * 1000 };
  const HART_VERS_MS = 60 * 60 * 1000;          // rechtstreeks en niets veranderd: toch eens per uur
  const LIJN_VERS_MS = 5 * 60 * 1000;           // een wifi-antwoord of een baken van hoogstens vijf minuten oud telt als "rechtstreeks"
  const OPDRACHT_GELDIG_MS = 60 * 60 * 1000;
  const MAX_OPDRACHTEN = 10;
  const MAX_GEDAAN = 20;
  const LIJNEN = ['rechtstreeks', 'bluetooth', 'postbus', 'weg'];
  const ID_RE = /^[a-z0-9]{12,40}$/;
  const NR_RE = /^[0-9a-f]{16}$/;

  const tekstBytes = (t) => new TextEncoder().encode(t);
  const naarHex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  const hexNaar = (h) => new Uint8Array(String(h).match(/../g).map((x) => parseInt(x, 16)));
  const cryptoNu = (c) => c || (typeof crypto !== 'undefined' ? crypto : null);
  const getal = (x, min, max) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null);

  // ---- De lijst van de bucket (ListObjectsV2) -> per plek de tijd van hart en opdrachtenbak ----
  const ontXml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  function leesLijst(xml) {
    const uit = new Map();
    const re = /<Contents>([\s\S]*?)<\/Contents>/g;
    let m;
    while ((m = re.exec(String(xml || '')))) {
      const k = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]);
      const d = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(m[1]);
      const p = k && /\/ontmoet\/(\d)\/(hart|opdracht)\.json$/.exec(ontXml(k[1]));
      if (!p || +p[1] >= AANTAL) continue;
      const n = +p[1];
      const rij = uit.get(n) || {};
      rij[p[2]] = d ? Date.parse(d[1]) || 0 : 0;
      uit.set(n, rij);
    }
    return uit;
  }

  // ---- Het hart ----
  function schoonLijnen(l) {
    const uit = {};
    if (!l || typeof l !== 'object') return uit;
    for (const id of Object.keys(l).slice(0, AANTAL)) if (ID_RE.test(id) && LIJNEN.includes(l[id])) uit[id] = l[id];
    return uit;
  }
  function schoonGedaan(g) {
    return (Array.isArray(g) ? g : []).filter((x) => x && NR_RE.test(String(x.n || ''))).slice(-MAX_GEDAAN).map((x) => ({
      n: String(x.n), soort: String(x.soort || '').replace(/[^a-z-]/g, '').slice(0, 24), t: Math.floor(Number(x.t) || 0),
      uitkomst: ['verwerkt', 'geweigerd'].includes(x.uitkomst) ? x.uitkomst : 'verwerkt',
    }));
  }
  // x = de velden van de hartslag (500) + { soort, plek, voorkeur, stand, tempoMs, lijnen, gedaan, fout }
  function schoonHart(x) {
    const h = x || {};
    const basis = Hartslag.schoonHartslag(h);
    return Object.assign(basis, {
      soort: h.soort === 'veronica' ? 'veronica' : 'jarvis',
      plek: Number.isInteger(h.plek) && h.plek >= 0 && h.plek < AANTAL ? h.plek : -1,
      voorkeur: h.voorkeur === 'kern' ? 'kern' : 'rek',
      stand: h.stand === 'rechtstreeks' ? 'rechtstreeks' : 'postbus',
      tempoMs: getal(h.tempoMs, 60 * 1000, 2 * HART_VERS_MS) || TEMPO.postbus,
      lijnen: schoonLijnen(h.lijnen),
      gedaan: schoonGedaan(h.gedaan),
      fout: String(h.fout || '').replace(/[^\p{L}\p{N} .,:%()_-]/gu, '').slice(0, 120),
    });
  }
  function leesHart(data) {
    let d = data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return null; } }
    if (!d || typeof d !== 'object' || d.v !== 1) return null;
    const h = schoonHart(d);
    return h.id && h.t ? h : null;
  }
  // Een hart is LEVEND zolang het niet ouder is dan zijn eigen belofte: via de postbus twee keer het tempo (minstens zeven minuten),
  // rechtstreeks een uur en een kwartier (dan komt er alleen bij een verandering een hart, en anders eens per uur).
  const levend = (h, nu) => !!h && nu - h.t <= (h.stand === 'rechtstreeks' ? HART_VERS_MS + 15 * 60 * 1000 : Math.max(2 * h.tempoMs, 7 * 60 * 1000));
  // Wat de verkeersleider (leider.js) als kandidaat kent. Een oud hart telt niet.
  function kandidaat(h, nu) {
    if (!h || h.soort !== 'jarvis' || !levend(h, nu)) return null;
    return { id: h.id, naam: h.naam, voorkeur: h.dagelijks ? 'kern' : h.voorkeur, rol: h.rol, laadt: h.laadt, procent: h.accu, temperatuur: h.temp, gezien: nu, viaPostbus: true };
  }

  // ---- Welke plek? ----
  // o = { harten: Map n -> hart (of null), mijnId, naam, eigenPlek, nu, veronica }
  function kiesPlek(o) {
    const harten = o.harten || new Map();
    const nu = o.nu;
    if (o.veronica) return VERONICA_PLEK;
    for (const [n, h] of harten) if (n !== VERONICA_PLEK && h && h.id === o.mijnId) return n;
    const eigen = o.eigenPlek;
    if (Number.isInteger(eigen) && eigen > 0 && eigen < AANTAL && !harten.get(eigen)) return eigen;
    for (let n = 1; n < AANTAL; n++) if (!harten.get(n)) return n;
    let best = null;
    for (let n = 1; n < AANTAL; n++) {
      const h = harten.get(n);
      const oud = nu - h.t >= PLEK_OUD_MS || (o.naam && h.naam === o.naam && nu - h.t >= ZELFDE_NAAM_STIL_MS);
      if (oud && (best === null || h.t < harten.get(best).t)) best = n;
    }
    return best;
  }
  const claimGelukt = (h, mijnId) => !!h && h.id === mijnId;

  // ---- De lijn naar elk ander toestel ----
  // anderen = [{ id, wifiT, blauwT, hart }] -> { lijnen: { id: lijn }, stand }
  //  rechtstreeks = een wifi-antwoord (met dit toestel-id) van hoogstens vijf minuten oud;
  //  bluetooth    = geen wifi, wel zijn baken gezien (hij is in de buurt, maar opdrachten gaan dan nog via de postbus);
  //  postbus      = alleen zijn hart in de postbus leeft;  weg = niets.
  // De STAND van dit toestel is 'rechtstreeks' als er minstens een ander is en elk levend toestel rechtstreeks bereikbaar is.
  function lijnen(anderen, nu) {
    const uit = {};
    let levendeAnderen = 0; let allemaalRecht = true;
    for (const a of anderen || []) {
      if (!a || !ID_RE.test(String(a.id || ''))) continue;
      const wifi = Number(a.wifiT) && nu - a.wifiT <= LIJN_VERS_MS;
      const blauw = Number(a.blauwT) && nu - a.blauwT <= LIJN_VERS_MS;
      const hart = levend(a.hart, nu);
      const l = wifi ? 'rechtstreeks' : blauw ? 'bluetooth' : hart ? 'postbus' : 'weg';
      uit[a.id] = l;
      if (l !== 'weg') { levendeAnderen += 1; if (l !== 'rechtstreeks') allemaalRecht = false; }
    }
    return { lijnen: uit, stand: levendeAnderen > 0 && allemaalRecht ? 'rechtstreeks' : 'postbus' };
  }
  const tempoMs = (stand) => (stand === 'rechtstreeks' ? TEMPO.rechtstreeks : TEMPO.postbus);
  // Moet het hart nu de postbus in? Via de postbus: elke drie minuten (zo zien de anderen dat hij leeft). Rechtstreeks: alleen bij
  // een verandering (hoogstens eens per kwartier) en anders eens per uur. Een nieuwe plek of een stand die omslaat: meteen.
  function hartNodig(o) {
    const x = o || {};
    const sinds = (x.nu || 0) - (x.laatstT || 0);
    if (x.plek !== x.laatstPlek || x.stand !== x.laatstStand) return true;
    if (x.stand !== 'rechtstreeks') return sinds >= TEMPO.postbus - 5000;
    if (x.sleutel !== x.laatstSleutel) return sinds >= TEMPO.rechtstreeks - 5000;
    return sinds >= HART_VERS_MS;
  }
  // Moet de opdrachtenbak gelezen worden? Alleen als de lijst zegt dat hij veranderde sinds de laatste keer.
  const opdrachtNieuw = (lijstRij, gelezenT) => !!(lijstRij && lijstRij.opdracht && lijstRij.opdracht > (gelezenT || 0));

  // ---- Opdrachten ----
  async function sleutel(code, gebruik, c) {
    const sub = cryptoNu(c).subtle;
    const raw = await sub.digest('SHA-256', tekstBytes('ontmoet-opdracht-sleutel:' + code));
    return sub.importKey('raw', raw, { name: 'AES-GCM' }, false, [gebruik]);
  }
  // roep = { naar: <toestel-id>, soort, ...velden } -> een item voor de bak, of null. De code reist mee BINNEN de versleuteling.
  async function maakOpdracht(roep, code, nu, van, c) {
    if (!/^\d{6}$/.test(String(code || '')) || !roep || typeof roep.soort !== 'string' || !ID_RE.test(String(roep.naar || ''))) return null;
    const n = new Uint8Array(8);
    cryptoNu(c).getRandomValues(n);
    const d = Object.assign({}, roep, { code: String(code), t: Math.floor(nu), n: naarHex(n), van: van === 'jarvis' ? 'jarvis' : 'veronica' });
    const tekst = JSON.stringify(d);
    if (tekst.length > 2048) return null;   // zelfde grens als /jarvis/roep
    const iv = new Uint8Array(12);
    cryptoNu(c).getRandomValues(iv);
    const data = await cryptoNu(c).subtle.encrypt({ name: 'AES-GCM', iv }, await sleutel(code, 'encrypt', c), tekstBytes(tekst));
    return { t: Math.floor(nu), n: d.n, iv: naarHex(iv), data: naarHex(data) };
  }
  // Een item erbij in de bak (lezen, toevoegen, terugleggen): verlopen weg, hoogstens tien.
  function voegToe(bak, item, nu) {
    const oud = bak && Array.isArray(bak.lijst) ? bak.lijst : [];
    const lijst = oud.filter((x) => x && NR_RE.test(String(x.n || '')) && nu - (Number(x.t) || 0) <= OPDRACHT_GELDIG_MS && x.n !== item.n);
    lijst.push(item);
    return { v: 1, lijst: lijst.slice(-MAX_OPDRACHTEN) };
  }
  // De bak lezen -> roepen als tekst (zoals /jarvis/roep ze geeft, ZONDER code). x = { code, id, nu, gezien: Set }.
  async function leesOpdrachten(bak, x, c) {
    let b = bak;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return []; } }
    const uit = [];
    if (!b || !Array.isArray(b.lijst) || !/^\d{6}$/.test(String(x.code || ''))) return uit;
    let s = null;
    for (const it of b.lijst.slice(-MAX_OPDRACHTEN)) {
      if (!it || !NR_RE.test(String(it.n || '')) || (x.gezien && x.gezien.has(it.n))) continue;
      if (Math.abs((x.nu || 0) - (Number(it.t) || 0)) > OPDRACHT_GELDIG_MS) continue;
      let d;
      try {
        s = s || await sleutel(String(x.code), 'decrypt', c);
        const p = await cryptoNu(c).subtle.decrypt({ name: 'AES-GCM', iv: hexNaar(it.iv) }, s, hexNaar(it.data));
        d = JSON.parse(new TextDecoder().decode(p));
      } catch (e) { continue; }   // een andere code, of geknoeid: niets
      if (!d || typeof d.soort !== 'string' || String(d.code) !== String(x.code) || d.naar !== x.id || d.n !== it.n) continue;
      if (Math.abs((x.nu || 0) - (Number(d.t) || 0)) > OPDRACHT_GELDIG_MS) continue;
      if (x.gezien) x.gezien.add(d.n);
      const roep = Object.assign({}, d);
      delete roep.code; delete roep.naar; delete roep.t; delete roep.n;
      uit.push({ n: d.n, soort: d.soort, tekst: JSON.stringify(roep) });
    }
    return uit;
  }
  function gedaanErbij(gedaan, g) { return schoonGedaan((Array.isArray(gedaan) ? gedaan : []).concat([g])); }

  // ---- In gewone taal (Veronica) ----
  function lijnZin(l) {
    return l === 'rechtstreeks' ? 'rechtstreeks (wifi)'
      : l === 'bluetooth' ? 'in de buurt (Bluetooth), opdrachten via de postbus'
        : l === 'postbus' ? 'via de postbus' : 'niet gezien';
  }

  return {
    AANTAL, VERONICA_PLEK, CLAIM_WACHT_MS, PLEK_OUD_MS, ZELFDE_NAAM_STIL_MS, TEMPO, HART_VERS_MS, LIJN_VERS_MS, OPDRACHT_GELDIG_MS,
    MAX_OPDRACHTEN, MAX_GEDAAN, LIJNEN,
    leesLijst, schoonHart, leesHart, levend, kandidaat, kiesPlek, claimGelukt, lijnen, tempoMs, hartNodig, opdrachtNieuw,
    maakOpdracht, voegToe, leesOpdrachten, gedaanErbij, lijnZin,
  };
}));
