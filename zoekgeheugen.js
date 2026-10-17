// ===================================================================
// 477: HET ZOEKGEHEUGEN VAN VERONICA -- eerdere zoekuitslagen, zoekbaar op betekenis-ruwweg
// ===================================================================
//
// Wat er eerder is gevonden (titel, korte tekst, adres, bron) blijft op DEZE computer, zodat een nieuwe vraag eerst in het eigen
// geheugen kan kijken: geen telefoon nodig, geen verzoek, geen wachttijd. Het is een LIJST voor mensen om te lezen. Het opent,
// plaatst en koopt niets, en het stuurt niets naar een telefoon of naar internet.
//
// WAT HET IS EN WAT NIET (eerlijk):
//  - De vectoren komen uit een INGEBOUWDE woorddeel-methode (gehashte woorden en lettergroepjes, 256 getallen, cosinus). Dat vindt
//    "schaatsen" bij "schaatsmuseum" en negeert hoofdletters en accenten, maar het begrijpt GEEN synoniemen ("fiets" is niet "rijwiel").
//  - EmbeddingGemma is NIET aangesloten. Een telefoon kan geen embeddings leveren (de eigen motor heeft alleen een chat-eindpunt) en het
//    model is vanuit de bouwomgeving niet na te kijken. De plek ervoor is er wel: maak({ embedder }) neemt elke functie (tekst) -> getallen,
//    en zodra zo'n bron bestaat is dat de ENE regel die verandert. Een geheugen dat met een andere methode is gemaakt wordt NIET
//    gemengd: de vectoren worden bij het laden opnieuw gerekend met de methode die nu geldt.
//  - Alleen wat de zoekpoort van Veronica al heeft doorgelaten komt erin (geen persoonlijke termen) en alleen openbare resultaten
//    (https-adressen). Er staat geen enkele zoekterm van een privé-vraag in, want die komen hier nooit.
//
// 481 (stap D): HET GEHEUGENMODEL VAN EEN TELEFOON (EmbeddingGemma via de eigen motor van JARVIS, /v1/embeddings). Geeft de
// pagina een `bron` mee ({ naam, embed(teksten, soort) }), dan zoekt het geheugen daarmee -- met de vaste voorvoegsels
// ("task: search result | text: " bij het opslaan, "task: search query | text: " bij het zoeken). Die vectoren (256 getallen)
// worden WEL bewaard, met de naam van de bron erbij: elke keer opnieuw rekenen via het wifi is te zwaar. Een andere bron = ze
// tellen niet mee (nooit twee soorten door elkaar). Is er geen telefoon met het geheugenmodel, of faalt hij, dan valt het
// zoeken terug op de ingebouwde woorddelen-methode, voor ALLE stukken (nooit gemengd in een ranglijst).
//
// Geen netwerk, geen innerHTML. De opslag is een kleine haak (lees/schrijf van een JSON-tekst); de pagina geeft haar IndexedDB.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.ZoekGeheugen = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIM = 256;
  const MAX_STUKKEN = 1500;
  const MAX_TEKST = 300;
  const MIN_SCORE = 0.28;
  const METHODE = 'woorddelen-256';
  const PREFIX_RESULTAAT = 'task: search result | text: ';
  const PREFIX_VRAAG = 'task: search query | text: ';
  const MIN_SCORE_BRON = 0.3;
  const BRON_PER_KEER = 32;       // zoveel teksten per verzoek aan de telefoon
  const BRON_NIEUW_MAX = 64;      // zoveel nog niet berekende stukken per zoekvraag erbij (de rest volgt bij de volgende)

  function schoon(t) {
    return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function fnv(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // De ingebouwde methode: elk woord telt mee, plus elk groepje van drie letters binnen een woord (halve gewicht).
  function ingebouwdeVector(tekst) {
    const v = new Array(DIM).fill(0);
    const woorden = schoon(tekst).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    for (const w of woorden) {
      v[fnv('w:' + w) % DIM] += 1;
      const kaal = `#${w}#`;
      for (let i = 0; i + 3 <= kaal.length; i++) v[fnv('t:' + kaal.slice(i, i + 3)) % DIM] += 0.5;
    }
    return normaal(v);
  }
  function normaal(v) {
    let s = 0;
    for (const x of v) s += x * x;
    const n = Math.sqrt(s);
    return n > 0 ? v.map((x) => x / n) : v;
  }
  function cosinus(a, b) {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  }
  const sleutelVan = (url, titel) => fnv(`${String(url || '').split('#')[0].toLowerCase()}|${schoon(titel)}`).toString(36);

  // o: { opslag: { lees() -> tekst|null, schrijf(tekst) }, embedder?: async (tekst) -> getallen, nu? }
  function maak(o) {
    const opt = o || {};
    const nu = opt.nu || (() => Date.now());
    const embedder = typeof opt.embedder === 'function' ? opt.embedder : null;
    const methode = embedder ? String(opt.embedderNaam || 'eigen-embedder') : METHODE;
    const stukken = new Map();   // id -> { id, term, titel, tekst, url, bronnen, t, vec, evec? }
    const bron = opt.bron && typeof opt.bron.embed === 'function' && typeof opt.bron.naam === 'string' ? opt.bron : null;
    const schoonTekst = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    // De bron: teksten -> vectoren (lijst van getallen), of null bij een fout. Alleen geldige, even lange vectoren tellen.
    async function bronVectoren(teksten, soort) {
      if (!bron || !teksten.length) return null;
      const pre = soort === 'vraag' ? PREFIX_VRAAG : PREFIX_RESULTAAT;
      let uit = null;
      try { uit = await bron.embed(teksten.map((t) => pre + schoonTekst(t)), soort); } catch (e) { uit = null; }
      if (!Array.isArray(uit) || uit.length !== teksten.length) return null;
      const lengte = Array.isArray(uit[0]) ? uit[0].length : 0;
      if (!lengte || !uit.every((v) => Array.isArray(v) && v.length === lengte && v.every((x) => typeof x === 'number' && Number.isFinite(x)))) return null;
      return uit.map((v) => normaal(v.map(Number)));
    }
    async function vulBron(lijst) {
      for (let i = 0; i < lijst.length; i += BRON_PER_KEER) {
        const deel = lijst.slice(i, i + BRON_PER_KEER);
        const v = await bronVectoren(deel.map((x) => tekstVoor(x)), 'resultaat');
        if (!v) return false;
        deel.forEach((x, j) => { x.evec = v[j]; });
      }
      return true;
    }
    let geladen = false;

    const vec = async (tekst) => {
      if (!embedder) return ingebouwdeVector(tekst);
      const v = await embedder(tekst);
      return Array.isArray(v) && v.length ? normaal(v.map(Number)) : ingebouwdeVector(tekst);
    };
    const tekstVoor = (s) => `${s.titel} ${s.titel} ${s.tekst} ${s.term}`;

    async function laad() {
      if (geladen) return;
      geladen = true;
      let ruw = null;
      try { ruw = opt.opslag && opt.opslag.lees ? await opt.opslag.lees() : null; } catch (e) { ruw = null; }
      let data = null;
      try { data = ruw ? JSON.parse(ruw) : null; } catch (e) { data = null; }
      if (!data || !Array.isArray(data.stukken)) return;
      const evecGeldig = bron && data.bronNaam === bron.naam;   // 481: alleen vectoren van DEZE bron
      // De vectoren worden altijd opnieuw gerekend met de methode die NU geldt: nooit twee soorten door elkaar.
      for (const s of data.stukken.slice(-MAX_STUKKEN)) {
        if (!s || typeof s.url !== 'string' || !/^https:\/\//i.test(s.url)) continue;
        const stuk = { id: String(s.id), term: String(s.term || '').slice(0, 200), titel: String(s.titel || '').slice(0, 200), tekst: String(s.tekst || '').slice(0, MAX_TEKST), url: s.url.slice(0, 400), bronnen: Array.isArray(s.bronnen) ? s.bronnen.map(String).slice(0, 6) : [], t: Number(s.t) || 0 };
        stuk.vec = await vec(tekstVoor(stuk));
        if (evecGeldig && Array.isArray(s.evec) && s.evec.length && s.evec.every((x) => typeof x === 'number' && Number.isFinite(x))) stuk.evec = normaal(s.evec);
        stukken.set(stuk.id, stuk);
      }
    }
    async function bewaar() {
      if (!opt.opslag || !opt.opslag.schrijf) return;
      // De woorddelen-vectoren NIET (die rekent de pagina zelf); de vectoren van de bron WEL, afgerond, met de naam van de bron.
      const lijst = [...stukken.values()].map(({ vec: _v, evec, ...rest }) => (bron && evec ? Object.assign(rest, { evec: evec.map((x) => Math.round(x * 10000) / 10000) }) : rest));
      try { await opt.opslag.schrijf(JSON.stringify({ methode, bronNaam: bron ? bron.naam : null, stukken: lijst })); } catch (e) { /* het geheugen is een gemak, geen vereiste */ }
    }

    // Onthoud de samengevoegde uitslag van een geslaagde zoekvraag (de vorm van VeronicaZoek.zoek).
    async function onthoud(uitslag) {
      await laad();
      if (!uitslag || !uitslag.ok || !Array.isArray(uitslag.samengevoegd)) return 0;
      let nieuw = 0;
      for (const r of uitslag.samengevoegd) {
        if (!r || !/^https:\/\//i.test(String(r.url || ''))) continue;
        const id = sleutelVan(r.url, r.titel);
        const bestond = stukken.has(id);
        const stuk = { id, term: String(uitslag.term || '').slice(0, 200), titel: String(r.titel || '').slice(0, 200), tekst: String(r.tekst || '').slice(0, MAX_TEKST), url: String(r.url).slice(0, 400), bronnen: (r.bronnen || []).map(String).slice(0, 6), t: nu() };
        stuk.vec = await vec(tekstVoor(stuk));
        stukken.delete(id);           // opnieuw achteraan = de nieuwste
        stukken.set(id, stuk);
        if (!bestond) nieuw += 1;
      }
      while (stukken.size > MAX_STUKKEN) stukken.delete(stukken.keys().next().value);
      if (bron) await vulBron([...stukken.values()].filter((x) => !x.evec).slice(-BRON_NIEUW_MAX));   // lukt het niet: bij het zoeken nog eens
      await bewaar();
      return nieuw;
    }

    // De beste eerdere resultaten voor een vraag, de beste eerst. Alleen echt overeenkomende (MIN_SCORE).
    async function zoek(vraag, n) {
      await laad();
      const q = String(vraag || '').trim().slice(0, 200);
      if (!q || !stukken.size) return [];
      // 481: eerst het geheugenmodel van een telefoon; lukt dat niet, dan de woorddelen (voor alle stukken, niet gemengd).
      if (bron) {
        const qb = await bronVectoren([q], 'vraag');
        if (qb) {
          const zonder = [...stukken.values()].filter((x) => !x.evec).slice(-BRON_NIEUW_MAX);
          if (zonder.length && await vulBron(zonder)) await bewaar();
          const uitB = [];
          for (const s of stukken.values()) {
            if (!s.evec || s.evec.length !== qb[0].length) continue;
            const score = cosinus(qb[0], s.evec);
            if (score >= MIN_SCORE_BRON) uitB.push({ titel: s.titel, tekst: s.tekst, url: s.url, bronnen: s.bronnen, term: s.term, t: s.t, score: Math.round(score * 100) / 100, methode: bron.naam });
          }
          uitB.sort((a, b) => b.score - a.score || b.t - a.t);
          return uitB.slice(0, Math.max(1, Math.min(20, n || 8)));
        }
      }
      const qv = await vec(q);
      const uit = [];
      for (const s of stukken.values()) {
        const score = cosinus(qv, s.vec);
        if (score >= MIN_SCORE) uit.push({ titel: s.titel, tekst: s.tekst, url: s.url, bronnen: s.bronnen, term: s.term, t: s.t, score: Math.round(score * 100) / 100, methode });
      }
      uit.sort((a, b) => b.score - a.score || b.t - a.t);
      return uit.slice(0, Math.max(1, Math.min(20, n || 8)));
    }

    async function wisAlles() { await laad(); stukken.clear(); await bewaar(); }
    async function telling() { await laad(); return stukken.size; }

    return Object.freeze({ onthoud, zoek, wisAlles, telling, methode, laad });
  }

  return { maak, ingebouwdeVector, cosinus, DIM, MAX_STUKKEN, MIN_SCORE, METHODE, PREFIX_RESULTAAT, PREFIX_VRAAG, MIN_SCORE_BRON };
}));
